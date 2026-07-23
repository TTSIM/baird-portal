import { createHmac, timingSafeEqual } from "node:crypto";
import OpenAI, { toFile } from "openai";
import { getKnowledge, getKnowledgeFile, saveKnowledge } from "./data.js";
import { env, requiredEnv } from "./env.js";

export const MAX_KNOWLEDGE_BYTES = 4 * 1024 * 1024;

export const KNOWLEDGE_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".html": ["text/html"]
};

export function knowledgeExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

export function validateKnowledgeFile(file: File) {
  const extension = knowledgeExtension(file.name);
  const allowed = KNOWLEDGE_TYPES[extension];
  if (!allowed) throw new Error("Upload a PDF, DOC, DOCX, PPTX, TXT, Markdown, or HTML file.");
  if (!file.size) throw new Error("The uploaded file is empty.");
  if (file.size > MAX_KNOWLEDGE_BYTES) throw new Error("Files must be 4 MB or smaller.");
  if (file.type && file.type !== "application/octet-stream" && !allowed.includes(file.type.toLowerCase())) {
    throw new Error("The file type does not match its extension.");
  }
  return { extension, mimeType: file.type || allowed[0] };
}

function jobSignature(id: string) {
  return createHmac("sha256", requiredEnv("SESSION_SECRET")).update(`knowledge:${id}`).digest("hex");
}

export function validKnowledgeJob(id: string, signature: string | null) {
  if (!signature) return false;
  const expected = Buffer.from(jobSignature(id), "utf8");
  const actual = Buffer.from(signature, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function triggerKnowledgeIndex(request: Request, id: string) {
  const endpoint = new URL("/api/internal/knowledge-index", request.url);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BAIRD-Knowledge-Job": jobSignature(id)
    },
    body: JSON.stringify({ id })
  });
  if (!response.ok) throw new Error(`Indexing worker returned ${response.status}.`);
}

export async function processKnowledgeSource(id: string) {
  const record = await getKnowledge(id);
  if (!record || record.status === "deleting") return;

  const indexing = {
    ...record,
    status: "indexing" as const,
    error: undefined,
    failureOperation: undefined,
    updatedAt: new Date().toISOString()
  };
  await saveKnowledge(indexing);

  try {
    const contents = await getKnowledgeFile(indexing);
    if (!contents) throw new Error("The private source file is missing.");
    const client = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY"), timeout: 120_000, maxRetries: 2 });
    const vectorStoreId = requiredEnv("OPENAI_VECTOR_STORE_ID");

    if (indexing.openaiFileId) {
      await client.files.delete(indexing.openaiFileId).catch(() => undefined);
    }

    const upload = await client.files.create({
      purpose: "assistants",
      file: await toFile(Buffer.from(contents), indexing.originalFilename, { type: indexing.mimeType })
    });
    const afterUpload = await getKnowledge(id);
    if (!afterUpload || afterUpload.status === "deleting") {
      await client.files.delete(upload.id).catch(() => undefined);
      return;
    }
    await saveKnowledge({
      ...afterUpload,
      openaiFileId: upload.id,
      updatedAt: new Date().toISOString()
    });

    const batch = await client.vectorStores.fileBatches.createAndPoll(vectorStoreId, {
      files: [{
        file_id: upload.id,
        attributes: {
          managed_by: "ask_dr_hassan_private_upload",
          scope: "course",
          course_id: indexing.courseId,
          source_visibility: "private_ai_only",
          source_title: indexing.title.slice(0, 512),
          source_type: "Additional material"
        }
      }]
    });
    if (batch.status !== "completed" || batch.file_counts.failed) {
      throw new Error("OpenAI could not index this file.");
    }

    const latest = await getKnowledge(id);
    if (!latest || latest.status === "deleting") return;
    await saveKnowledge({
      ...latest,
      status: "ready",
      openaiFileId: upload.id,
      error: undefined,
      failureOperation: undefined,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    const latest = await getKnowledge(id);
    if (!latest || latest.status === "deleting") return;
    await saveKnowledge({
      ...latest,
      status: "failed",
      error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      failureOperation: "index",
      updatedAt: new Date().toISOString()
    });
  }
}

export async function removeKnowledgeFromOpenAI(openaiFileId: string | undefined) {
  if (!openaiFileId) return;
  const apiKey = env("OPENAI_API_KEY");
  const vectorStoreId = env("OPENAI_VECTOR_STORE_ID");
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to delete an indexed source.");
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });
  if (vectorStoreId) {
    await client.vectorStores.files.delete(openaiFileId, { vector_store_id: vectorStoreId }).catch(() => undefined);
  }
  await client.files.delete(openaiFileId).catch(() => undefined);
}
