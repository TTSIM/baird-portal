import assert from "node:assert/strict";
import { File } from "node:buffer";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildKnowledgeRecords,
  COURSE_MATERIAL_COUNT,
  extractQuestionBanks
} from "../../scripts/lib/knowledge.mjs";
import {
  MAX_KNOWLEDGE_BYTES,
  validateKnowledgeFile
} from "../../netlify/functions/_shared/knowledge.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("discovers and validates every current lecture and quiz", async () => {
  const result = await buildKnowledgeRecords(root);
  assert.equal(result.courseCount, COURSE_MATERIAL_COUNT);
  assert.deepEqual(result.errors, []);
  assert.equal(result.records.filter((record) => record.type === "Lecture").length, 41);
  assert.equal(result.records.filter((record) => record.type === "Quiz").length, 38);
});

test("extracts visible lectures, alternate quiz arrays, and iframe quiz banks", async () => {
  const result = await buildKnowledgeRecords(root);
  const byPath = new Map(result.records.map((record) => [record.relativePath, record.buffer.toString("utf8")]));

  assert.match(byPath.get("materials/lectures/lecture_1_foundations_history_bone_biology.html"), /Per-Ingvar Brånemark/);
  assert.match(byPath.get("materials/module3-day1/quiz-1.html"), /Correct answer:/);
  assert.match(byPath.get("materials/module4-day1/quiz-1-evidence-critical-appraisal.html"), /current AI when appraising/i);
  assert.match(byPath.get("materials/quizzes/module2_day2_quiz1.html"), /Correct answer:/);
});

test("recognizes supported quiz bank variable names without executing source code", () => {
  const source = `const QUESTIONS = [{ q: "Question?", opts: ["No", "Yes"], ans: 1, fb: "Because." }];`;
  const banks = extractQuestionBanks(source);
  assert.equal(banks.length, 1);
  assert.equal(banks[0][0].q, "Question?");
});

test("adds supported copied materials with stable source metadata", async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dr-hassan-knowledge-"));
  t.after(() => fs.rm(temporaryRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(temporaryRoot, "materials", "lectures"), { recursive: true });
  await fs.mkdir(path.join(temporaryRoot, "knowledge", "additional"), { recursive: true });
  await fs.mkdir(path.join(temporaryRoot, "data"), { recursive: true });
  await fs.writeFile(
    path.join(temporaryRoot, "materials", "lectures", "sample.html"),
    "<!doctype html><title>Sample lecture</title><body><h1>Sample</h1><p>This is a sufficiently detailed sample lecture for extraction and validation testing.</p></body>"
  );

  for (const filename of ["transcript.txt", "handout.pdf", "notes.docx", "slides.pptx"]) {
    await fs.writeFile(path.join(temporaryRoot, "knowledge", "additional", filename), `test content for ${filename}`);
  }
  await fs.writeFile(path.join(temporaryRoot, "data", "course-catalog.json"), JSON.stringify({
    courses: [{ id: "sample-course", title: "Sample course", moduleIds: ["sample-module"] }],
    modules: [{
      id: "sample-module",
      courseId: "sample-course",
      title: "Sample module",
      knowledgeFiles: ["materials/lectures/sample.html"],
      days: []
    }]
  }));
  await fs.writeFile(path.join(temporaryRoot, "knowledge", "additional", "manifest.json"), JSON.stringify({
    sources: Object.fromEntries(["transcript.txt", "handout.pdf", "notes.docx", "slides.pptx"]
      .map((filename) => [filename, { courseId: "sample-course" }]))
  }));

  const result = await buildKnowledgeRecords(temporaryRoot);
  assert.equal(result.courseCount, 1);
  assert.equal(result.additionalCount, 4);
  assert.deepEqual(result.errors, []);
  const privateSource = result.records.find((record) => record.relativePath === "knowledge/additional/handout.pdf");
  assert.equal(privateSource.href, null);
  assert.equal(privateSource.attributes.scope, "course");
  assert.equal(privateSource.attributes.course_id, "sample-course");
  assert.equal(privateSource.attributes.source_visibility, "private_ai_only");
});

test("validates admin knowledge upload extension, MIME, size, and content", () => {
  assert.doesNotThrow(() => validateKnowledgeFile(new File(["course notes"], "notes.pdf", { type: "application/pdf" })));
  assert.throws(() => validateKnowledgeFile(new File([], "empty.pdf", { type: "application/pdf" })), /empty/);
  assert.throws(() => validateKnowledgeFile(new File(["notes"], "notes.exe", { type: "application/octet-stream" })), /Upload a PDF/);
  assert.throws(() => validateKnowledgeFile(new File(["notes"], "notes.pdf", { type: "text/plain" })), /does not match/);
  assert.throws(
    () => validateKnowledgeFile(new File([Buffer.alloc(MAX_KNOWLEDGE_BYTES + 1)], "large.pdf", { type: "application/pdf" })),
    /4 MB/
  );
});
