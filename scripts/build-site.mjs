import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");

const sources = [
  "index.html",
  "baird_implant_portal.html",
  "ask-dr-hassan.html",
  "assets",
  "materials",
  path.join("knowledge", "additional")
];

await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });

for (const source of sources) {
  const from = path.join(root, source);
  const to = path.join(output, source);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

console.log(`Static portal assembled in ${path.relative(root, output)}/`);
