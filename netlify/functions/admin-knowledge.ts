import { randomUUID } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireStaff } from "./_shared/auth.js";
import { allCourseIds, publicCourseOptions } from "./_shared/course-catalog.js";
import {
  deleteKnowledgeFile,
  deleteKnowledgeRecord,
  getKnowledge,
  listKnowledge,
  saveKnowledge,
  saveKnowledgeFile
} from "./_shared/data.js";
import {
  removeKnowledgeFromOpenAI,
  triggerKnowledgeIndex,
  validateKnowledgeFile
} from "./_shared/knowledge.js";
import type { KnowledgeSourceRecord } from "./_shared/models.js";

export default async function handler(request: Request, context: Context) {
  try {
    const admin = await requireStaff(request);
    const url = new URL(request.url);

    if (request.method === "GET") {
      return Response.json({
        sources: await listKnowledge(),
        courses: publicCourseOptions()
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      const courseId = String(form.get("courseId") || "");
      if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.", "MISSING_FILE");
      if (!allCourseIds.has(courseId)) throw new HttpError(400, "Choose a valid course.", "INVALID_COURSE");

      let mimeType: string;
      try {
        ({ mimeType } = validateKnowledgeFile(file));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid file.", "INVALID_FILE");
      }

      const title = String(form.get("title") || file.name).trim().slice(0, 200);
      if (!title) throw new HttpError(400, "Enter a source title.", "MISSING_TITLE");
      const id = randomUUID();
      const now = new Date().toISOString();
      const record: KnowledgeSourceRecord = {
        id,
        title,
        originalFilename: file.name.slice(0, 255),
        mimeType,
        bytes: file.size,
        courseId,
        status: "queued",
        blobKey: `sources/${id}`,
        uploadedBy: { id: admin.id, name: admin.name, email: admin.email },
        createdAt: now,
        updatedAt: now
      };

      await saveKnowledge(record);
      try {
        await saveKnowledgeFile(record, file);
      } catch (error) {
        await deleteKnowledgeRecord(id);
        throw error;
      }
      context.waitUntil(triggerKnowledgeIndex(request, id).catch(async (error) => {
        await saveKnowledge({
          ...record,
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 500) : "The indexing worker could not be started.",
          failureOperation: "index",
          updatedAt: new Date().toISOString()
        });
      }));
      return Response.json({ source: record }, { status: 201 });
    }

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "A source ID is required.", "MISSING_ID");
      const record = await getKnowledge(id);
      if (!record) throw new HttpError(404, "Knowledge source not found.", "NOT_FOUND");
      const deleting = { ...record, status: "deleting" as const, updatedAt: new Date().toISOString() };
      await saveKnowledge(deleting);
      try {
        await removeKnowledgeFromOpenAI(record.openaiFileId);
        await deleteKnowledgeFile(record);
        await deleteKnowledgeRecord(id);
      } catch (error) {
        await saveKnowledge({
          ...deleting,
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 500) : "Deletion failed.",
          failureOperation: "delete",
          updatedAt: new Date().toISOString()
        });
        throw error;
      }
      return new Response(null, { status: 204 });
    }

    return Response.json({ error: "Method not allowed." }, {
      status: 405,
      headers: { Allow: "GET, POST, DELETE" }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/admin/knowledge",
  method: ["GET", "POST", "DELETE"]
};
