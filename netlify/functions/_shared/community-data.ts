import { randomUUID } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { HttpError } from "./auth.js";
import type {
  CommunityAttachmentRecord,
  CommunityEmailJob,
  CommunityModerationRecord,
  CommunityNotificationRecord,
  CommunityPostRecord,
  CommunityReactionRecord,
  CommunityReplyRecord,
  CommunityReportRecord,
  CommunityTargetType,
  CommunityUploadRecord,
  ReactionKind
} from "./community.js";

const RECORDS_STORE = "baird-community-records";
const IMAGES_STORE = "baird-community-images";
const TEMP_STORE = "baird-community-temp";
const RATES_STORE = "baird-community-rates";

export function communityRecordsStore() {
  return getStore({ name: RECORDS_STORE, consistency: "strong" });
}

export function communityImagesStore() {
  return getStore({ name: IMAGES_STORE, consistency: "strong" });
}

export function communityTempStore() {
  return getStore({ name: TEMP_STORE, consistency: "strong" });
}

function communityRatesStore() {
  return getStore({ name: RATES_STORE, consistency: "strong" });
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const page of communityRecordsStore().list({ prefix, paginate: true })) {
    keys.push(...page.blobs.map(({ key }) => key));
  }
  return keys;
}

async function listRecords<T>(prefix: string): Promise<T[]> {
  const store = communityRecordsStore();
  const records = await Promise.all((await listKeys(prefix))
    .map(async (key) => await store.get(key, { type: "json" }) as T | null));
  const present: T[] = [];
  for (const record of records) {
    if (record !== null) present.push(record);
  }
  return present;
}

function feedIndexKey(post: CommunityPostRecord): string {
  const inverted = String(Number.MAX_SAFE_INTEGER - new Date(post.activityAt).getTime()).padStart(16, "0");
  return `feed/${inverted}/${post.id}`;
}

export async function savePost(post: CommunityPostRecord): Promise<void> {
  const store = communityRecordsStore();
  const current = await getPost(post.id);
  const oldIndex = current?.status === "active" ? feedIndexKey(current) : null;
  const newIndex = post.status === "active" ? feedIndexKey(post) : null;
  if (oldIndex && oldIndex !== newIndex) await store.delete(oldIndex);
  await store.setJSON(`posts/${post.id}`, post);
  if (newIndex) await store.setJSON(newIndex, { postId: post.id, activityAt: post.activityAt });
}

export async function getPost(id: string): Promise<CommunityPostRecord | null> {
  return await communityRecordsStore().get(`posts/${id}`, { type: "json" }) as CommunityPostRecord | null;
}

export async function listPosts(): Promise<CommunityPostRecord[]> {
  return await listRecords<CommunityPostRecord>("posts/");
}

export async function listFeedPosts(): Promise<CommunityPostRecord[]> {
  const posts = await Promise.all((await listKeys("feed/")).map(async (key) => {
    const postId = key.split("/").at(-1);
    return postId ? await getPost(postId) : null;
  }));
  return posts.filter((post): post is CommunityPostRecord => Boolean(post));
}

export async function saveReply(reply: CommunityReplyRecord): Promise<void> {
  await communityRecordsStore().setJSON(`replies/${reply.postId}/${reply.id}`, reply);
}

export async function getReply(postId: string, id: string): Promise<CommunityReplyRecord | null> {
  return await communityRecordsStore().get(`replies/${postId}/${id}`, { type: "json" }) as CommunityReplyRecord | null;
}

export async function findReply(id: string): Promise<CommunityReplyRecord | null> {
  const replies = await listRecords<CommunityReplyRecord>("replies/");
  return replies.find((reply) => reply.id === id) || null;
}

export async function listReplies(postId: string): Promise<CommunityReplyRecord[]> {
  return (await listRecords<CommunityReplyRecord>(`replies/${postId}/`))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listAllReplies(): Promise<CommunityReplyRecord[]> {
  return await listRecords<CommunityReplyRecord>("replies/");
}

export async function deletePostRecord(id: string): Promise<void> {
  const store = communityRecordsStore();
  const post = await getPost(id);
  if (post?.status === "active") await store.delete(feedIndexKey(post));
  await store.delete(`posts/${id}`);
}

export async function deleteReplyRecord(postId: string, id: string): Promise<void> {
  await communityRecordsStore().delete(`replies/${postId}/${id}`);
}

function reactionKey(
  targetType: CommunityTargetType,
  targetId: string,
  reaction: ReactionKind,
  userId: string
) {
  return `reactions/${targetType}/${targetId}/${reaction}/${userId}`;
}

export async function setReaction(record: CommunityReactionRecord): Promise<void> {
  await communityRecordsStore().setJSON(
    reactionKey(record.targetType, record.targetId, record.reaction, record.userId),
    record
  );
}

export async function deleteReaction(
  targetType: CommunityTargetType,
  targetId: string,
  reaction: ReactionKind,
  userId: string
): Promise<void> {
  await communityRecordsStore().delete(reactionKey(targetType, targetId, reaction, userId));
}

export async function listReactions(
  targetType: CommunityTargetType,
  targetId: string
): Promise<CommunityReactionRecord[]> {
  return await listRecords<CommunityReactionRecord>(`reactions/${targetType}/${targetId}/`);
}

export async function saveReport(report: CommunityReportRecord): Promise<void> {
  await communityRecordsStore().setJSON(
    `reports/${report.status}/${report.targetType}/${report.targetId}/${report.reporterId}`,
    report
  );
}

export async function getReportForUser(
  targetType: CommunityTargetType,
  targetId: string,
  userId: string
): Promise<CommunityReportRecord | null> {
  const store = communityRecordsStore();
  return await store.get(`reports/open/${targetType}/${targetId}/${userId}`, { type: "json" }) as CommunityReportRecord | null
    || await store.get(`reports/reviewed/${targetType}/${targetId}/${userId}`, { type: "json" }) as CommunityReportRecord | null;
}

export async function listReports(status?: "open" | "reviewed"): Promise<CommunityReportRecord[]> {
  return (await listRecords<CommunityReportRecord>(status ? `reports/${status}/` : "reports/"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markReportsReviewed(
  targetType: CommunityTargetType,
  targetId: string,
  reviewerId: string
): Promise<void> {
  const store = communityRecordsStore();
  const reports = (await listReports("open")).filter((report) =>
    report.targetType === targetType && report.targetId === targetId);
  const now = new Date().toISOString();
  await Promise.all(reports.map(async (report) => {
    await store.delete(`reports/open/${report.targetType}/${report.targetId}/${report.reporterId}`);
    await saveReport({ ...report, status: "reviewed", reviewedAt: now, reviewedBy: reviewerId });
  }));
}

export async function saveNotification(notification: CommunityNotificationRecord): Promise<void> {
  await communityRecordsStore().setJSON(
    `notifications/${notification.userId}/${notification.createdAt}/${notification.id}`,
    notification
  );
}

export async function listNotifications(userId: string): Promise<CommunityNotificationRecord[]> {
  return (await listRecords<CommunityNotificationRecord>(`notifications/${userId}/`))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<void> {
  const notifications = await listNotifications(userId);
  const targets = ids?.length ? notifications.filter(({ id }) => ids.includes(id)) : notifications;
  const now = new Date().toISOString();
  await Promise.all(targets.filter(({ readAt }) => !readAt).map(async (notification) => {
    await saveNotification({ ...notification, readAt: now });
  }));
}

export async function saveModeration(record: CommunityModerationRecord): Promise<void> {
  await communityRecordsStore().setJSON(`moderation/${record.createdAt}/${record.id}`, record);
}

export async function listModeration(): Promise<CommunityModerationRecord[]> {
  return (await listRecords<CommunityModerationRecord>("moderation/"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveEmailJob(job: CommunityEmailJob): Promise<void> {
  await communityRecordsStore().setJSON(`email-jobs/${job.id}`, job);
}

export async function listEmailJobs(): Promise<CommunityEmailJob[]> {
  return await listRecords<CommunityEmailJob>("email-jobs/");
}

export async function saveUpload(upload: CommunityUploadRecord): Promise<void> {
  await communityRecordsStore().setJSON(`uploads/${upload.id}`, upload);
}

export async function getUpload(id: string): Promise<CommunityUploadRecord | null> {
  return await communityRecordsStore().get(`uploads/${id}`, { type: "json" }) as CommunityUploadRecord | null;
}

export async function deleteUpload(id: string): Promise<void> {
  await communityRecordsStore().delete(`uploads/${id}`);
}

export async function listUploads(): Promise<CommunityUploadRecord[]> {
  return await listRecords<CommunityUploadRecord>("uploads/");
}

export async function saveAttachment(attachment: CommunityAttachmentRecord): Promise<void> {
  await communityRecordsStore().setJSON(`attachments/${attachment.id}`, attachment);
}

export async function getAttachment(id: string): Promise<CommunityAttachmentRecord | null> {
  return await communityRecordsStore().get(`attachments/${id}`, { type: "json" }) as CommunityAttachmentRecord | null;
}

export async function deleteAttachmentRecord(id: string): Promise<void> {
  await communityRecordsStore().delete(`attachments/${id}`);
}

export async function listAttachments(): Promise<CommunityAttachmentRecord[]> {
  return await listRecords<CommunityAttachmentRecord>("attachments/");
}

export async function consumeCommunityRate(
  kind: "post" | "reply" | "reaction" | "image",
  userId: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): Promise<{ remaining: number }> {
  const store = communityRatesStore();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const prefix = `${kind}/${windowStart}/${userId}/`;
  const { blobs } = await store.list({ prefix });
  if (blobs.length >= limit) {
    throw new HttpError(429, "You have reached the current community activity limit.", "RATE_LIMITED");
  }
  await store.set(`${prefix}${now}-${randomUUID()}`, "1");
  return { remaining: Math.max(0, limit - blobs.length - 1) };
}

export async function deleteAttachmentContent(attachment: CommunityAttachmentRecord): Promise<void> {
  await Promise.all([
    communityImagesStore().delete(attachment.imageKey),
    communityImagesStore().delete(attachment.thumbnailKey)
  ]);
  await saveAttachment({ ...attachment, deletedAt: new Date().toISOString() });
}

export function newId(): string {
  return randomUUID();
}
