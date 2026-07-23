import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is required to create the Dr Hassan vector store.");
  process.exit(1);
}

const client = new OpenAI({ apiKey });
const vectorStore = await client.vectorStores.create({
  name: "BAIRD Ask Dr Hassan course library",
  description: "Lectures, quizzes, transcripts and formal materials used by the BAIRD Ask Dr Hassan course assistant."
});

console.log("Created the Dr Hassan vector store. Configure these values locally and in Netlify:");
console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);
console.log("OPENAI_MODEL=gpt-5.4-mini");
console.log("Then run: npm run knowledge:sync");
