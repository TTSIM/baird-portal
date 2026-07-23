import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRateLimit,
  collectCitations,
  COURSE_ONLY_FALLBACK,
  groundedAnswer,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_COUNT,
  RATE_LIMIT_WINDOW_MS,
  RequestValidationError,
  validateChatRequest
} from "../../netlify/functions/_shared/ask-dr-hassan-core.ts";

function responseFixture({ href = "/materials/lecture.html", citations = true } = {}) {
  return {
    id: "resp_test",
    object: "response",
    output_text: "Osseointegration is described in the lecture.",
    output: [
      {
        id: "search_test",
        type: "file_search_call",
        status: "completed",
        queries: ["osseointegration"],
        results: [{
          file_id: "file_test",
          filename: "course__lecture.md",
          text: "  A source excerpt with   extra whitespace. ",
          score: 0.9,
          attributes: {
            source_href: href,
            source_title: "Foundations of Implant Dentistry",
            source_type: "Lecture"
          }
        }]
      },
      {
        id: "message_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: "Osseointegration is described in the lecture.",
          annotations: citations ? [{ type: "file_citation", file_id: "file_test", filename: "course__lecture.md", index: 0 }] : []
        }]
      }
    ]
  };
}

test("validates and trims a supported conversation", () => {
  assert.deepEqual(validateChatRequest({ messages: [{ role: "user", content: "  Explain this  " }] }), [
    { role: "user", content: "Explain this" }
  ]);
});

test("rejects invalid roles, oversized messages, and an assistant final turn", () => {
  assert.throws(() => validateChatRequest({ messages: [{ role: "system", content: "No" }] }), RequestValidationError);
  assert.throws(() => validateChatRequest({ messages: [{ role: "user", content: "x".repeat(MAX_MESSAGE_LENGTH + 1) }] }), /cannot exceed/);
  assert.throws(() => validateChatRequest({ messages: [{ role: "assistant", content: "Answer" }] }), /final conversation turn/);
});

test("maps, cleans, and deduplicates verified local citations", () => {
  const response = responseFixture();
  const duplicate = structuredClone(response.output[1].content[0].annotations[0]);
  response.output[1].content[0].annotations.push(duplicate);
  const citations = collectCitations(response);

  assert.equal(citations.length, 1);
  assert.deepEqual(citations[0], {
    label: "Foundations of Implant Dentistry",
    href: "/materials/lecture.html",
    type: "Lecture",
    excerpt: "A source excerpt with extra whitespace."
  });
});

test("drops external citation targets and falls back when citations are absent", () => {
  const unsafe = responseFixture({ href: "https://example.com/material" });
  assert.deepEqual(collectCitations(unsafe), []);
  assert.equal(groundedAnswer(unsafe, []), COURSE_ONLY_FALLBACK);

  const uncited = responseFixture({ citations: false });
  assert.equal(groundedAnswer(uncited, collectCitations(uncited)), COURSE_ONLY_FALLBACK);
});

test("anonymises private AI-only citations without exposing a link or excerpt", () => {
  const response = responseFixture({ href: undefined });
  response.output[0].results[0].attributes = {
    source_title: "Confidential external lecture",
    source_type: "Additional material",
    source_visibility: "private_ai_only",
    course_id: "implant-dentistry-2026"
  };
  assert.deepEqual(collectCitations(response), [{
    label: "Additional BAIRD course reference",
    type: "Private course reference",
    excerpt: "",
    private: true,
    courseId: "implant-dentistry-2026"
  }]);
});

test("allows twenty requests per daily window and reports retry timing", () => {
  const now = 1_000_000;
  let record = null;
  for (let count = 0; count < RATE_LIMIT_COUNT; count += 1) {
    const result = calculateRateLimit(record, now);
    assert.equal(result.allowed, true);
    record = result.next;
  }

  const limited = calculateRateLimit(record, now);
  assert.equal(limited.allowed, false);
  assert.equal(limited.retryAfterSeconds, RATE_LIMIT_WINDOW_MS / 1000);

  const reset = calculateRateLimit(record, now + RATE_LIMIT_WINDOW_MS);
  assert.equal(reset.allowed, true);
  assert.equal(reset.next.count, 1);
});
