import { createHash, randomUUID } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import OpenAI from "openai";
import type { CompoundFilter } from "openai/resources/shared";
import {
  collectCitations,
  groundedAnswer,
  MAX_REQUEST_BYTES,
  RATE_LIMIT_COUNT,
  RequestValidationError,
  validateChatRequest
} from "./_shared/ask-dr-hassan-core.js";
import { requireUser } from "./_shared/auth.js";
import { allModuleIds, courseIdsForGrants } from "./_shared/course-catalog.js";
import { consumeDailyQuestion, saveUsage } from "./_shared/data.js";
import { env } from "./_shared/env.js";
import type { AskUsageRecord, UserRecord } from "./_shared/models.js";
import { hasFullCourseAccess } from "./_shared/roles.js";

const SYSTEM_INSTRUCTIONS = `You are Ask Dr Hassan, an AI BAIRD course companion inspired by Dr Hassan. Never claim to be the real Dr Hassan or imply that he is responding live.

Answer only from the BAIRD files returned by file search. Do not use general knowledge to fill gaps. Every factual answer must be supported by at least one file citation. If the course library does not contain enough support, say so plainly. Keep answers clear, concise, educational, and useful for revision. Use plain text with short paragraphs or simple hyphen bullets; do not use Markdown tables.

Voice: sound like a very playful, warm lecturer. In most supported educational answers, use friendly banter, encouragement, and one or two concise jokes. Keep the humour brief and never let it obscure the teaching. Never invent personal anecdotes, never joke at a patient's or learner's expense, and never use humour to introduce an uncited factual claim.

You may explain quiz material and create revision questions from the files. Do not provide patient-specific diagnosis, treatment planning, prescribing, or clinical advice. If asked for those, explain that Ask Dr Hassan is an educational AI course companion and direct the learner to an appropriate supervising clinician. Be direct and professional without jokes for clinical-safety refusals, unsupported-answer fallbacks, or other serious safety contexts.`;

function responseError(error: string, code: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error, code }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function sseEvent(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export function buildFileSearchFilter(moduleIds: string[], courseIds: string[]): CompoundFilter {
  return {
    type: "or",
    filters: [
      {
        type: "and",
        filters: [
          { type: "eq", key: "scope", value: "module" },
          { type: "in", key: "module_id", value: moduleIds }
        ]
      },
      {
        type: "and",
        filters: [
          { type: "eq", key: "scope", value: "course" },
          { type: "in", key: "course_id", value: courseIds },
          { type: "eq", key: "source_visibility", value: "private_ai_only" }
        ]
      }
    ]
  };
}

function usageRecord(input: {
  user: UserRecord;
  question: string;
  status: AskUsageRecord["status"];
  model: string;
  startedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  moduleIds?: string[];
  courseIds?: string[];
  citations?: AskUsageRecord["citations"];
}): AskUsageRecord {
  const inputTokens = input.inputTokens || 0;
  const outputTokens = input.outputTokens || 0;
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    user: { id: input.user.id, name: input.user.name, email: input.user.email, role: input.user.role },
    question: input.question,
    status: input.status,
    model: input.model,
    latencyMs: Date.now() - input.startedAt,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    matchedCourseIds: input.courseIds || [],
    matchedModuleIds: input.moduleIds || [],
    citations: input.citations || []
  };
}

export default async function handler(request: Request, context: Context) {
  if (request.method !== "POST") {
    return responseError("Only POST requests are accepted.", "METHOD_NOT_ALLOWED", 405, { Allow: "POST" });
  }

  let user: UserRecord;
  try {
    user = await requireUser(request);
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 401;
    return responseError("Sign in to continue.", "UNAUTHENTICATED", status);
  }

  const moduleIds = hasFullCourseAccess(user.role) ? [...allModuleIds] : user.grants;
  if (!moduleIds.length) {
    return responseError("Ask Dr Hassan is available after a course module is unlocked.", "NO_COURSE_ACCESS", 403);
  }
  const courseIds = courseIdsForGrants(moduleIds);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return responseError("The conversation is too large to send.", "REQUEST_TOO_LARGE", 413);
  }

  let messages;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return responseError("The conversation is too large to send.", "REQUEST_TOO_LARGE", 413);
    }
    messages = validateChatRequest(JSON.parse(rawBody));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return responseError(error.message, error.code, 400);
    }
    return responseError("Send a valid JSON request body.", "INVALID_JSON", 400);
  }

  const question = messages.at(-1)?.content || "";
  const model = env("OPENAI_MODEL") || "gpt-5.4-mini";
  const startedAt = Date.now();
  const apiKey = env("OPENAI_API_KEY");
  const vectorStoreId = env("OPENAI_VECTOR_STORE_ID");
  if (!apiKey || !vectorStoreId) {
    return responseError("Dr Hassan has not been fully configured yet.", "NOT_CONFIGURED", 503);
  }

  let limit;
  try {
    limit = hasFullCourseAccess(user.role)
      ? { allowed: true, remaining: RATE_LIMIT_COUNT }
      : await consumeDailyQuestion(user.id, RATE_LIMIT_COUNT);
  } catch (error) {
    console.error("Dr Hassan rate-limit store failed", error);
    return responseError("Dr Hassan’s usage controls are temporarily unavailable. Please try again shortly.", "RATE_LIMIT_UNAVAILABLE", 503);
  }

  const rateHeaders = {
    "X-RateLimit-Limit": String(RATE_LIMIT_COUNT),
    "X-RateLimit-Remaining": String(limit.remaining)
  };

  if (!limit.allowed) {
    context.waitUntil(saveUsage(usageRecord({
      user,
      question,
      status: "rate_limited",
      model,
      startedAt
    })));
    return responseError(
      "You have reached today’s 20-question limit. It resets at midnight UK time.",
      "RATE_LIMITED",
      429,
      rateHeaders
    );
  }

  try {
    const client = new OpenAI({ apiKey, timeout: 52_000, maxRetries: 1 });
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: messages,
      tools: [{
        type: "file_search",
        vector_store_ids: [vectorStoreId],
        max_num_results: 8,
        filters: buildFileSearchFilter(moduleIds, courseIds)
      }],
      tool_choice: "required",
      include: ["file_search_call.results"],
      max_output_tokens: 1_200,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      safety_identifier: createHash("sha256").update(`baird:${user.id}`).digest("hex"),
      store: false
    });

    const citations = collectCitations(response);
    const answer = groundedAnswer(response, citations);
    const supported = answer === response.output_text.trim();
    const verifiedCitations = supported ? citations : [];
    const matchedModuleIds = [...new Set(verifiedCitations.map(({ moduleId }) => moduleId).filter((id): id is string => Boolean(id)))];
    const matchedCourseIds = [...new Set(verifiedCitations.map(({ courseId }) => courseId).filter((id): id is string => Boolean(id)))];
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;

    context.waitUntil(saveUsage(usageRecord({
      user,
      question,
      status: supported ? "success" : "unsupported",
      model,
      startedAt,
      inputTokens,
      outputTokens,
      moduleIds: matchedModuleIds,
      courseIds: matchedCourseIds,
      citations: verifiedCitations.map(({ label, href, type }) => ({ label, href, type }))
    })));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunks = answer.match(/[\s\S]{1,120}/g) || [answer];
        chunks.forEach((text) => controller.enqueue(encoder.encode(sseEvent({ type: "delta", text }))));
        controller.enqueue(encoder.encode(sseEvent({ type: "done", answer, citations: verifiedCitations })));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
        ...rateHeaders
      }
    });
  } catch (error) {
    console.error("Dr Hassan OpenAI request failed", error);
    context.waitUntil(saveUsage(usageRecord({
      user,
      question,
      status: "provider_error",
      model,
      startedAt
    })));
    return responseError("Dr Hassan could not reach the course library just now. Please try again.", "PROVIDER_ERROR", 502, rateHeaders);
  }
}

export const config: Config = {
  path: "/api/ask-dr-hassan",
  method: "POST"
};
