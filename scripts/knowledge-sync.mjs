import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI, { toFile } from "openai";
import {
  buildKnowledgeRecords,
  COURSE_MATERIAL_COUNT,
  formatKnowledgeSummary,
  MANAGED_BY
} from "./lib/knowledge.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const rootDirectory = path.resolve(scriptDirectory, "..");
const checkOnly = process.argv.includes("--check");

const result = await buildKnowledgeRecords(rootDirectory);
console.log(formatKnowledgeSummary(result));

if (result.courseCount !== COURSE_MATERIAL_COUNT) {
  result.errors.push(`expected ${COURSE_MATERIAL_COUNT} course materials but discovered ${result.courseCount}`);
}

if (result.errors.length) {
  console.error("\nKnowledge validation failed:");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

if (checkOnly) {
  console.log("Knowledge sources are ready to sync.");
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
if (!apiKey || !vectorStoreId) {
  console.error("OPENAI_API_KEY and OPENAI_VECTOR_STORE_ID are required. Run npm run knowledge:init first.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });
const currentFiles = [];
const currentPage = await client.vectorStores.files.list(vectorStoreId, { limit: 100 });
for await (const file of currentPage) currentFiles.push(file);

const managedFiles = currentFiles.filter((file) => file.attributes?.managed_by === MANAGED_BY);
const currentByPath = new Map(managedFiles.map((file) => [String(file.attributes?.source_path), file]));
const desiredPaths = new Set(result.records.map((record) => record.relativePath));

let uploaded = 0;
let unchanged = 0;
let removed = 0;

for (const record of result.records) {
  const current = currentByPath.get(record.relativePath);
  if (current?.attributes?.content_sha256 === record.hash && current.status === "completed") {
    unchanged += 1;
    continue;
  }

  const openaiFile = await client.files.create({
    file: await toFile(record.buffer, record.filename),
    purpose: "assistants"
  });

  const attached = await client.vectorStores.files.createAndPoll(vectorStoreId, {
    file_id: openaiFile.id,
    attributes: record.attributes
  });

  if (attached.status !== "completed") {
    throw new Error(`OpenAI could not index ${record.relativePath}: ${attached.last_error?.message || attached.status}`);
  }

  if (current) {
    await client.vectorStores.files.delete(current.id, { vector_store_id: vectorStoreId });
    await client.files.delete(current.id).catch(() => undefined);
  }

  uploaded += 1;
  console.log(`Synced ${record.relativePath}`);
}

for (const current of managedFiles) {
  const sourcePath = String(current.attributes?.source_path || "");
  if (desiredPaths.has(sourcePath)) continue;
  await client.vectorStores.files.delete(current.id, { vector_store_id: vectorStoreId });
  await client.files.delete(current.id).catch(() => undefined);
  removed += 1;
  console.log(`Removed stale source ${sourcePath || current.id}`);
}

console.log(`Knowledge sync complete: ${uploaded} uploaded, ${unchanged} unchanged, ${removed} removed.`);
