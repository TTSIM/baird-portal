import { createHash, randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { AskUsageRecord, KnowledgeSourceRecord, UserRecord } from "./models.js";

const USERS_STORE = "baird-users";
const USAGE_STORE = "baird-ask-usage";
const RATE_STORE = "baird-ask-rate";
const KNOWLEDGE_STORE = "baird-knowledge";
const KNOWLEDGE_FILES_STORE = "baird-knowledge-files";

function usersStore() {
  return getStore({ name: USERS_STORE, consistency: "strong" });
}

async function listKeys(store: ReturnType<typeof getStore>, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const page of store.list({ prefix, paginate: true })) {
    keys.push(...page.blobs.map(({ key }) => key));
  }
  return keys;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function emailIndexKey(email: string) {
  return `by-email/${createHash("sha256").update(normalizeEmail(email)).digest("hex")}`;
}

export async function getUserById(id: string): Promise<UserRecord | null> {
  return await usersStore().get(`records/${id}`, { type: "json" }) as UserRecord | null;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const store = usersStore();
  const id = await store.get(emailIndexKey(email));
  return id ? await store.get(`records/${id}`, { type: "json" }) as UserRecord | null : null;
}

export async function listUsers(): Promise<UserRecord[]> {
  const store = usersStore();
  const records = await Promise.all((await listKeys(store, "records/"))
    .map((key) => store.get(key, { type: "json" }) as Promise<UserRecord | null>));
  return records.filter((record): record is UserRecord => Boolean(record))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function createUser(input: {
  email: string;
  name: string;
  role: UserRecord["role"];
  grants?: string[];
  active?: boolean;
  googleSub?: string;
}): Promise<UserRecord> {
  const email = normalizeEmail(input.email);
  if (await getUserByEmail(email)) throw new Error("A user with that email already exists.");
  const now = new Date().toISOString();
  const record: UserRecord = {
    id: randomUUID(),
    email,
    name: input.name.trim() || email,
    role: input.role,
    active: input.active ?? true,
    grants: input.grants || [],
    googleSub: input.googleSub,
    createdAt: now,
    updatedAt: now
  };
  const store = usersStore();
  const indexWrite = await store.set(emailIndexKey(email), record.id, { onlyIfNew: true });
  if (!indexWrite.modified) throw new Error("A user with that email already exists.");
  try {
    await store.setJSON(`records/${record.id}`, record);
  } catch (error) {
    await store.delete(emailIndexKey(email));
    throw error;
  }
  return record;
}

export async function saveUser(record: UserRecord): Promise<UserRecord> {
  const next = { ...record, email: normalizeEmail(record.email), updatedAt: new Date().toISOString() };
  await usersStore().setJSON(`records/${next.id}`, next);
  return next;
}

export async function activeOwnerCount(): Promise<number> {
  return (await listUsers()).filter((user) => user.active && user.role === "owner").length;
}

export async function saveUsage(record: AskUsageRecord): Promise<void> {
  await getStore(USAGE_STORE).setJSON(`events/${record.createdAt}/${record.id}`, record);
}

export async function listUsage(): Promise<AskUsageRecord[]> {
  const store = getStore(USAGE_STORE);
  const records = await Promise.all((await listKeys(store, "events/"))
    .map((key) => store.get(key, { type: "json" }) as Promise<AskUsageRecord | null>));
  return records.filter((record): record is AskUsageRecord => Boolean(record));
}

export async function deleteUsage(id: string): Promise<boolean> {
  const store = getStore(USAGE_STORE);
  const target = (await listKeys(store, "events/")).find((key) => key.endsWith(`/${id}`));
  if (!target) return false;
  await store.delete(target);
  return true;
}

function londonDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export async function consumeDailyQuestion(userId: string, limit = 20, now = new Date()) {
  const store = getStore({ name: RATE_STORE, consistency: "strong" });
  const key = `${londonDate(now)}/${userId}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json" }) as {
      data: { count: number } | null;
      etag: string;
    } | null;
    const count = Number(current?.data?.count || 0);
    if (count >= limit) return { allowed: false, remaining: 0 };
    const options = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    const result = await store.set(key, JSON.stringify({ count: count + 1 }), options);
    if (result.modified) return { allowed: true, remaining: limit - count - 1 };
  }

  throw new Error("Could not update the daily usage counter.");
}

function knowledgeStore() {
  return getStore({ name: KNOWLEDGE_STORE, consistency: "strong" });
}

export async function saveKnowledge(record: KnowledgeSourceRecord): Promise<void> {
  await knowledgeStore().setJSON(`records/${record.id}`, record);
}

export async function getKnowledge(id: string): Promise<KnowledgeSourceRecord | null> {
  return await knowledgeStore().get(`records/${id}`, { type: "json" }) as KnowledgeSourceRecord | null;
}

export async function listKnowledge(): Promise<KnowledgeSourceRecord[]> {
  const store = knowledgeStore();
  const records = await Promise.all((await listKeys(store, "records/"))
    .map((key) => store.get(key, { type: "json" }) as Promise<KnowledgeSourceRecord | null>));
  return records.filter((record): record is KnowledgeSourceRecord => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteKnowledgeRecord(id: string): Promise<void> {
  await knowledgeStore().delete(`records/${id}`);
}

export async function saveKnowledgeFile(record: KnowledgeSourceRecord, file: File): Promise<void> {
  await getStore(KNOWLEDGE_FILES_STORE).set(record.blobKey, file, {
    metadata: { mimeType: record.mimeType, bytes: record.bytes, courseId: record.courseId }
  });
}

export async function getKnowledgeFile(record: KnowledgeSourceRecord): Promise<ArrayBuffer | null> {
  return await getStore(KNOWLEDGE_FILES_STORE).get(record.blobKey, { type: "arrayBuffer" });
}

export async function deleteKnowledgeFile(record: KnowledgeSourceRecord): Promise<void> {
  await getStore(KNOWLEDGE_FILES_STORE).delete(record.blobKey);
}
