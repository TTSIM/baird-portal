import type { Response as OpenAIResponse } from "openai/resources/responses/responses";

export const MAX_TURNS = 12;
export const MAX_MESSAGE_LENGTH = 2_000;
export const MAX_REQUEST_BYTES = 32 * 1024;
export const RATE_LIMIT_COUNT = 20;
export const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const COURSE_ONLY_FALLBACK = "I couldn’t find enough information in the available BAIRD course materials to answer that reliably. Try rephrasing the question or ask about a specific lecture or quiz.";

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };
export type Citation = {
  label: string;
  href?: string;
  type: string;
  excerpt: string;
  private?: boolean;
  courseId?: string;
  moduleId?: string;
};

export class RequestValidationError extends Error {
  code: string;

  constructor(message: string, code = "INVALID_REQUEST") {
    super(message);
    this.name = "RequestValidationError";
    this.code = code;
  }
}

export function validateChatRequest(value: unknown): ChatMessage[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { messages?: unknown }).messages)) {
    throw new RequestValidationError("Send a messages array containing the current conversation.");
  }

  const messages = (value as { messages: unknown[] }).messages;
  if (!messages.length || messages.length > MAX_TURNS) {
    throw new RequestValidationError(`Send between 1 and ${MAX_TURNS} conversation turns.`);
  }

  const normalized = messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      throw new RequestValidationError(`Message ${index + 1} is invalid.`);
    }

    const role = (message as { role?: unknown }).role;
    const content = (message as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant") {
      throw new RequestValidationError(`Message ${index + 1} has an unsupported role.`);
    }
    if (typeof content !== "string" || !content.trim()) {
      throw new RequestValidationError(`Message ${index + 1} must contain text.`);
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new RequestValidationError(`Messages cannot exceed ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`, "MESSAGE_TOO_LONG");
    }

    return { role, content: content.trim() } as ChatMessage;
  });

  if (normalized.at(-1)?.role !== "user") {
    throw new RequestValidationError("The final conversation turn must be a user question.");
  }

  return normalized;
}

function safeLocalHref(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://baird.invalid");
    return url.origin === "https://baird.invalid" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

function cleanExcerpt(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 237).trimEnd()}…` : clean;
}

export function collectCitations(response: OpenAIResponse): Citation[] {
  const results = new Map<string, {
    attributes?: Record<string, string | number | boolean> | null;
    filename?: string;
    text?: string;
  }>();
  const citedIds: string[] = [];

  for (const item of response.output) {
    if (item.type === "file_search_call") {
      for (const result of item.results || []) {
        if (result.file_id) results.set(result.file_id, result);
      }
    }

    if (item.type === "message") {
      for (const content of item.content) {
        if (content.type !== "output_text") continue;
        for (const annotation of content.annotations) {
          if (annotation.type === "file_citation") citedIds.push(annotation.file_id);
        }
      }
    }
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const fileId of citedIds) {
    const result = results.get(fileId);
    const attributes = result?.attributes || {};
    const isPrivate = attributes.source_visibility === "private_ai_only";
    const href = safeLocalHref(attributes.source_href);
    const key = isPrivate ? `private:${fileId}` : href;
    if (!key || seen.has(key)) continue;
    seen.add(key);

    citations.push({
      label: isPrivate
        ? "Additional BAIRD course reference"
        : typeof attributes.source_title === "string" ? attributes.source_title : result?.filename || "BAIRD source",
      ...(href && !isPrivate ? { href } : {}),
      type: isPrivate ? "Private course reference" : typeof attributes.source_type === "string" ? attributes.source_type : "Course material",
      excerpt: isPrivate ? "" : cleanExcerpt(result?.text),
      ...(isPrivate ? { private: true } : {}),
      ...(typeof attributes.course_id === "string" ? { courseId: attributes.course_id } : {}),
      ...(typeof attributes.module_id === "string" ? { moduleId: attributes.module_id } : {})
    });
  }

  return citations;
}

export type RateRecord = { windowStartedAt: number; count: number };

export function calculateRateLimit(record: RateRecord | null, now: number) {
  if (!record || !Number.isFinite(record.windowStartedAt) || now - record.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    return {
      allowed: true,
      next: { windowStartedAt: now, count: 1 },
      remaining: RATE_LIMIT_COUNT - 1,
      retryAfterSeconds: 0
    };
  }

  if (record.count >= RATE_LIMIT_COUNT) {
    return {
      allowed: false,
      next: record,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStartedAt)) / 1000))
    };
  }

  return {
    allowed: true,
    next: { ...record, count: record.count + 1 },
    remaining: RATE_LIMIT_COUNT - record.count - 1,
    retryAfterSeconds: 0
  };
}

export function groundedAnswer(response: OpenAIResponse, citations: Citation[]): string {
  const answer = response.output_text.trim();
  return answer && citations.length ? answer : COURSE_ONLY_FALLBACK;
}
