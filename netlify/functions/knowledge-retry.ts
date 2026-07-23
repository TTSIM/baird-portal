import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireStaff } from "./_shared/auth.js";
import { getKnowledge, saveKnowledge } from "./_shared/data.js";
import { triggerKnowledgeIndex } from "./_shared/knowledge.js";

export default async function handler(request: Request, context: Context) {
  try {
    await requireStaff(request);
    const match = new URL(request.url).pathname.match(/^\/api\/admin\/knowledge\/([^/]+)\/retry$/);
    const id = match ? decodeURIComponent(match[1]) : "";
    if (!id) throw new HttpError(400, "A source ID is required.", "MISSING_ID");
    const record = await getKnowledge(id);
    if (!record) throw new HttpError(404, "Knowledge source not found.", "NOT_FOUND");
    if (record.status !== "failed" || record.failureOperation === "delete") {
      throw new HttpError(409, "Only failed indexing can be retried.", "NOT_FAILED");
    }
    const queued = {
      ...record,
      status: "queued" as const,
      error: undefined,
      failureOperation: undefined,
      updatedAt: new Date().toISOString()
    };
    await saveKnowledge(queued);
    context.waitUntil(triggerKnowledgeIndex(request, id).catch(async (error) => {
      await saveKnowledge({
        ...queued,
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "The indexing worker could not be started.",
        failureOperation: "index",
        updatedAt: new Date().toISOString()
      });
    }));
    return Response.json({ source: queued });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/admin/knowledge/:id/retry",
  method: "POST"
};
