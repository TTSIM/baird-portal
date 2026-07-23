import type { Config } from "@netlify/functions";
import { processKnowledgeSource, validKnowledgeJob } from "./_shared/knowledge.js";

export default async function handler(request: Request) {
  if (request.method !== "POST") return new Response("Method not allowed.", { status: 405 });
  let id = "";
  try {
    const body = await request.json() as { id?: unknown };
    id = typeof body.id === "string" ? body.id : "";
  } catch {
    return new Response("Invalid request.", { status: 400 });
  }
  if (!id || !validKnowledgeJob(id, request.headers.get("x-baird-knowledge-job"))) {
    return new Response("Forbidden.", { status: 403 });
  }
  await processKnowledgeSource(id);
  return new Response(null, { status: 204 });
}

export const config: Config = {
  path: "/api/internal/knowledge-index",
  method: "POST"
};
