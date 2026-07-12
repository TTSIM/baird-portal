import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse } from "acorn";
import { load } from "cheerio";

export const COURSE_MATERIAL_COUNT = 79;
export const MANAGED_BY = "ask_dr_hassan";
export const SUPPORTED_ADDITIONAL_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".pptx", ".html", ".md", ".txt"
]);

const QUESTION_ARRAY_NAMES = new Set(["questions", "qs", "q"]);

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function humanizeFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function encodeLocalHref(relativePath) {
  return `/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function inferType(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.includes("quiz")) return "Quiz";
  if (lower.includes("lecture")) return "Lecture";
  return "Course material";
}

async function walkFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(target));
    else if (entry.isFile()) files.push(target);
  }

  return files;
}

function literalFromNode(node) {
  if (!node) return undefined;

  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((part) => part.value.cooked ?? part.value.raw).join("");
  }
  if (node.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
    const value = literalFromNode(node.argument);
    return typeof value === "number" ? (node.operator === "-" ? -value : value) : undefined;
  }
  if (node.type === "ArrayExpression") {
    return node.elements.map(literalFromNode);
  }
  if (node.type === "ObjectExpression") {
    const object = {};
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.kind !== "init") continue;
      const key = property.key.type === "Identifier" ? property.key.name : literalFromNode(property.key);
      if (typeof key !== "string") continue;
      object[key] = literalFromNode(property.value);
    }
    return object;
  }

  return undefined;
}

function visitAst(node, visitor) {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visitAst(child, visitor));
    else if (value && typeof value === "object" && typeof value.type === "string") visitAst(value, visitor);
  }
}

export function extractQuestionBanks(scriptText) {
  let program;
  try {
    program = parse(scriptText, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true
    });
  } catch {
    return [];
  }

  const banks = [];
  visitAst(program, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
    if (!QUESTION_ARRAY_NAMES.has(node.id.name.toLowerCase())) return;
    const value = literalFromNode(node.init);
    if (!Array.isArray(value) || !value.some((item) => item && typeof item === "object")) return;
    banks.push(value);
  });

  return banks;
}

export function extractEmbeddedCourseText(scriptText) {
  let program;
  try {
    program = parse(scriptText, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true
    });
  } catch {
    return [];
  }

  const candidates = [];
  visitAst(program, (node) => {
    if (node.type === "Literal" && typeof node.value === "string") candidates.push(node.value);
    if (node.type === "TemplateLiteral") {
      candidates.push(...node.quasis.map((part) => part.value.cooked ?? part.value.raw));
    }
  });

  const seen = new Set();
  return candidates
    .map((candidate) => normalizeWhitespace(load(`<body>${candidate}</body>`)("body").text()))
    .filter((candidate) => candidate.length >= 28 && candidate.split(/\s+/).length >= 5)
    .filter((candidate) => !/^(?:querySelector|addEventListener|classList|linear-gradient|rgba?\()/i.test(candidate))
    .filter((candidate) => {
      const key = candidate.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeQuestion(item) {
  if (!item || typeof item !== "object") return null;
  const question = item.q ?? item.question ?? item.prompt;
  const options = item.opts ?? item.options ?? item.o ?? item.answers;
  const answer = item.ans ?? item.answer ?? item.a ?? item.correct ?? item.c;
  const explanation = item.fb ?? item.feedback ?? item.e ?? item.explanation ?? item.rationale ?? item.exp;

  if (typeof question !== "string" || !Array.isArray(options)) return null;

  let correctAnswer = "";
  if (Number.isInteger(answer) && options[answer] !== undefined) correctAnswer = String(options[answer]);
  else if (typeof answer === "string") correctAnswer = answer;

  return {
    question: normalizeWhitespace(question),
    options: options.map(normalizeWhitespace).filter(Boolean),
    correctAnswer: normalizeWhitespace(correctAnswer),
    explanation: normalizeWhitespace(explanation),
    topic: normalizeWhitespace(item.topic ?? item.t)
  };
}

function extractVisibleText($) {
  const body = $("body").clone();
  body.find("script, style, noscript, svg, iframe, .portal-back, [aria-hidden='true']").remove();

  body.find("br").replaceWith("\n");
  body.find("p, li, h1, h2, h3, h4, h5, h6, section, article, div, tr").each((_, element) => {
    $(element).append("\n");
  });

  return normalizeWhitespace(body.text());
}

async function extractHtmlParts(filePath, visited = new Set()) {
  const resolvedPath = path.resolve(filePath);
  if (visited.has(resolvedPath)) return { visibleText: "", questions: [] };
  visited.add(resolvedPath);

  const html = await fs.readFile(resolvedPath, "utf8");
  const $ = load(html);
  const questions = [];
  const embeddedTexts = [];

  $("script:not([src])").each((_, script) => {
    const scriptText = $(script).html() || "";
    for (const bank of extractQuestionBanks(scriptText)) {
      questions.push(...bank.map(normalizeQuestion).filter(Boolean));
    }
    embeddedTexts.push(...extractEmbeddedCourseText(scriptText));
  });

  const nestedTexts = [];
  for (const iframe of $("iframe[src]").toArray()) {
    const src = $(iframe).attr("src");
    if (!src || /^(?:https?:)?\/\//i.test(src)) continue;
    const nestedPath = path.resolve(path.dirname(resolvedPath), decodeURIComponent(src.split(/[?#]/)[0]));
    try {
      const nested = await extractHtmlParts(nestedPath, visited);
      nestedTexts.push(nested.visibleText);
      nestedTexts.push(nested.embeddedText);
      questions.push(...nested.questions);
    } catch {
      // Validation reports insufficient wrapper content if a local iframe is missing.
    }
  }

  const seenQuestions = new Set();
  const uniqueQuestions = questions.filter((question) => {
    const key = question.question.toLowerCase();
    if (seenQuestions.has(key)) return false;
    seenQuestions.add(key);
    return true;
  });

  return {
    title: normalizeWhitespace($("title").first().text() || $("h1").first().text()),
    visibleText: normalizeWhitespace([extractVisibleText($), ...nestedTexts].filter(Boolean).join("\n\n")),
    embeddedText: normalizeWhitespace(embeddedTexts.join("\n\n")),
    questions: uniqueQuestions
  };
}

function renderCourseMarkdown({ title, relativePath, type, visibleText, embeddedText, questions }) {
  const lines = [
    `# ${title}`,
    "",
    `- Material type: ${type}`,
    `- Original source: ${relativePath}`,
    ""
  ];

  if (visibleText) lines.push("## Course content", "", visibleText, "");
  if (embeddedText) lines.push("## Embedded interactive content", "", embeddedText, "");

  if (questions.length) {
    lines.push("## Quiz questions and explanations", "");
    questions.forEach((question, index) => {
      lines.push(`### Question ${index + 1}: ${question.question}`, "");
      if (question.topic) lines.push(`Topic: ${question.topic}`, "");
      question.options.forEach((option, optionIndex) => {
        lines.push(`- ${String.fromCharCode(65 + optionIndex)}. ${option}`);
      });
      if (question.correctAnswer) lines.push("", `Correct answer: ${question.correctAnswer}`);
      if (question.explanation) lines.push("", `Explanation: ${question.explanation}`);
      lines.push("");
    });
  }

  return normalizeWhitespace(lines.join("\n")) + "\n";
}

function uploadName(prefix, relativePath, replacementExtension) {
  const parsed = path.parse(relativePath);
  const withExtension = path.join(parsed.dir, `${parsed.name}${replacementExtension ?? parsed.ext}`);
  return `${prefix}__${withExtension.replace(/[\\/]+/g, "__").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}

function createRecord({ buffer, relativePath, title, type, filename }) {
  const hash = createHash("sha256").update(buffer).digest("hex");
  return {
    buffer,
    filename,
    relativePath,
    title,
    type,
    hash,
    href: encodeLocalHref(relativePath),
    attributes: {
      managed_by: MANAGED_BY,
      source_path: relativePath.slice(0, 512),
      source_href: encodeLocalHref(relativePath).slice(0, 512),
      source_title: title.slice(0, 512),
      source_type: type,
      content_sha256: hash
    }
  };
}

export async function buildKnowledgeRecords(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const materialRoot = path.join(root, "materials");
  const additionalRoot = path.join(root, "knowledge", "additional");

  const allMaterialFiles = await walkFiles(materialRoot);
  const courseFiles = allMaterialFiles.filter((file) => {
    const relative = path.relative(materialRoot, file);
    return path.extname(file).toLowerCase() === ".html"
      && !relative.split(path.sep).some((segment) => segment.endsWith("_files"));
  });

  const records = [];
  const errors = [];

  for (const file of courseFiles) {
    const relativePath = path.relative(root, file);
    try {
      const extracted = await extractHtmlParts(file);
      const title = extracted.title || humanizeFilename(file);
      const type = inferType(relativePath);
      const markdown = renderCourseMarkdown({
        title,
        relativePath,
        type,
        visibleText: extracted.visibleText,
        embeddedText: extracted.embeddedText,
        questions: extracted.questions
      });

      if (markdown.length < 180) throw new Error("extracted content is unexpectedly short");

      records.push(createRecord({
        buffer: Buffer.from(markdown, "utf8"),
        relativePath,
        title,
        type,
        filename: uploadName("course", relativePath, ".md")
      }));
    } catch (error) {
      errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let additionalFiles = [];
  try {
    additionalFiles = await walkFiles(additionalRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  for (const file of additionalFiles) {
    const extension = path.extname(file).toLowerCase();
    if (!SUPPORTED_ADDITIONAL_EXTENSIONS.has(extension) || path.basename(file).toLowerCase() === "readme.md") continue;
    const relativePath = path.relative(root, file);
    const buffer = await fs.readFile(file);
    if (!buffer.length) {
      errors.push(`${relativePath}: file is empty`);
      continue;
    }

    records.push(createRecord({
      buffer,
      relativePath,
      title: humanizeFilename(file),
      type: "Additional material",
      filename: uploadName("additional", relativePath)
    }));
  }

  return {
    records,
    courseCount: courseFiles.length,
    additionalCount: records.length - courseFiles.length,
    errors
  };
}

export function formatKnowledgeSummary(result) {
  return [
    `Course materials: ${result.courseCount}`,
    `Additional materials: ${result.additionalCount}`,
    `Validation errors: ${result.errors.length}`
  ].join("\n");
}
