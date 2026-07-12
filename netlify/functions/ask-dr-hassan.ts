import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import OpenAI from "openai";
import {
  calculateRateLimit,
  collectCitations,
  groundedAnswer,
  MAX_REQUEST_BYTES,
  RequestValidationError,
  type RateRecord,
  validateChatRequest
} from "./_shared/ask-dr-hassan-core.js";

type NetlifyGlobal = typeof globalThis & {
  Netlify?: { env: { get(name: string): string | undefined } };
};

const SYSTEM_INSTRUCTIONS = `You are Dr Hassan, the BAIRD course companion.

Answer only from the BAIRD files returned by file search. Do not use general knowledge to fill gaps. Every factual answer must be supported by at least one file citation. If the course library does not contain enough support, say so plainly. Keep answers clear, concise, educational, and useful for revision. Use plain text with short paragraphs or simple hyphen bullets; do not use Markdown tables.

You may explain quiz material and create revision questions from the files. Do not provide patient-specific diagnosis, treatment planning, prescribing, or clinical advice. If asked for those, explain that Dr Hassan is an educational course companion and direct the learner to an appropriate supervising clinician.`;

function env(name: string): string | undefined {
  return (globalThis as NetlifyGlobal).Netlify?.env.get(name) ?? process.env[name];
}

function jsonError(error: string, code: string, status: number, headers: HeadersInit = {}) {
  return Response.json({ error, code }, {
    status,
    headers: { "Cache-Control": "no-store", ...headers }
  });
}

function sseEvent(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

async function applyRateLimit(ip: string) {
  const store = getStore({ name: "ask-dr-hassan-rate-limit", consistency: "strong" });
  const key = `ip/${createHash("sha256").update(ip || "unknown").digest("hex")}`;
  const current = await store.get(key, { type: "json" }) as RateRecord | null;
  const result = calculateRateLimit(current, Date.now());
  if (result.allowed) await store.setJSON(key, result.next);
  return result;
}

export default async function handler(request: Request, context: Context) {
  if (request.method !== "POST") {
    return jsonError("Only POST requests are accepted.", "METHOD_NOT_ALLOWED", 405, { Allow: "POST" });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonError("The conversation is too large to send.", "REQUEST_TOO_LARGE", 413);
  }

  let messages;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return jsonError("The conversation is too large to send.", "REQUEST_TOO_LARGE", 413);
    }
    messages = validateChatRequest(JSON.parse(rawBody));
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonError(error.message, error.code, 400);
    }
    return jsonError("Send a valid JSON request body.", "INVALID_JSON", 400);
  }

  let limit;
  try {
    limit = await applyRateLimit(context.ip || "unknown");
  } catch (error) {
    console.error("Dr Hassan rate-limit store failed", error);
    return jsonError("Dr Hassan’s usage controls are temporarily unavailable. Please try again shortly.", "RATE_LIMIT_UNAVAILABLE", 503);
  }

  const rateHeaders = {
    "X-RateLimit-Limit": "20",
    "X-RateLimit-Remaining": String(limit.remaining)
  };

  if (!limit.allowed) {
    return jsonError(
      "Dr Hassan has received a lot of questions. Please wait a moment and try again.",
      "RATE_LIMITED",
      429,
      { ...rateHeaders, "Retry-After": String(limit.retryAfterSeconds) }
    );
  }

  const apiKey = env("OPENAI_API_KEY");
  const vectorStoreId = env("OPENAI_VECTOR_STORE_ID");
  const model = env("OPENAI_MODEL") || "gpt-5.4-mini";
  if (!apiKey || !vectorStoreId) {
    return jsonError("Dr Hassan has not been fully configured yet.", "NOT_CONFIGURED", 503, rateHeaders);
  }

  try {
    const client = new OpenAI({ apiKey, timeout: 52_000, maxRetries: 1 });
    const response = await client.responses.create({
      model,
      instructions: SYSTEM_INSTRUCTIONS,
      input: messages,
      tools: [{ type: "file_search", vector_store_ids: [vectorStoreId], max_num_results: 8 }],
      tool_choice: "required",
      include: ["file_search_call.results"],
      max_output_tokens: 1_200,
      reasoning: { effort: "low" },
      text: { verbosity: "low" },
      store: false
    });

    const citations = collectCitations(response);
    const answer = groundedAnswer(response, citations);
    const verifiedCitations = answer === response.output_text.trim() ? citations : [];
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
    return jsonError("Dr Hassan could not reach the course library just now. Please try again.", "PROVIDER_ERROR", 502, rateHeaders);
  }
}

export const config: Config = {
  path: "/api/ask-dr-hassan",
  method: "POST"
};
