import assert from "node:assert/strict";
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
  await fs.writeFile(
    path.join(temporaryRoot, "materials", "lectures", "sample.html"),
    "<!doctype html><title>Sample lecture</title><body><h1>Sample</h1><p>This is a sufficiently detailed sample lecture for extraction and validation testing.</p></body>"
  );

  for (const filename of ["transcript.txt", "handout.pdf", "notes.docx", "slides.pptx"]) {
    await fs.writeFile(path.join(temporaryRoot, "knowledge", "additional", filename), `test content for ${filename}`);
  }

  const result = await buildKnowledgeRecords(temporaryRoot);
  assert.equal(result.courseCount, 1);
  assert.equal(result.additionalCount, 4);
  assert.deepEqual(result.errors, []);
  assert.ok(result.records.some((record) => record.href === "/knowledge/additional/handout.pdf"));
});
