import type { Config } from "@netlify/functions";
import { DELETE_RETENTION_MS, UPLOAD_EXPIRY_MS } from "./_shared/community.js";
import {
  communityTempStore,
  deleteAttachmentContent,
  deleteAttachmentRecord,
  deletePostRecord,
  deleteReplyRecord,
  deleteUpload,
  listAllReplies,
  listAttachments,
  listPosts,
  listUploads
} from "./_shared/community-data.js";

export default async function handler() {
  const now = Date.now();
  const [posts, replies, attachments, uploads] = await Promise.all([
    listPosts(),
    listAllReplies(),
    listAttachments(),
    listUploads()
  ]);
  const expiredPosts = posts.filter(({ deletedAt }) =>
    deletedAt && now - new Date(deletedAt).getTime() >= DELETE_RETENTION_MS);
  const expiredPostIds = new Set(expiredPosts.map(({ id }) => id));
  const expiredReplies = replies.filter(({ deletedAt, postId }) =>
    expiredPostIds.has(postId)
    || Boolean(deletedAt && now - new Date(deletedAt).getTime() >= DELETE_RETENTION_MS));
  const expiredAttachments = attachments.filter(({ createdAt, deletedAt, attachedTo }) =>
    Boolean(deletedAt && now - new Date(deletedAt).getTime() >= DELETE_RETENTION_MS)
    || Boolean(attachedTo?.type === "post" && expiredPostIds.has(attachedTo.id))
    || Boolean(!attachedTo && now - new Date(createdAt).getTime() >= UPLOAD_EXPIRY_MS));

  await Promise.all(expiredAttachments.map(async (attachment) => {
    if (!attachment.deletedAt) await deleteAttachmentContent(attachment);
    await deleteAttachmentRecord(attachment.id);
  }));
  await Promise.all(expiredReplies.map((reply) => deleteReplyRecord(reply.postId, reply.id)));
  await Promise.all(expiredPosts.map((post) => deletePostRecord(post.id)));

  const expiredUploads = uploads.filter(({ expiresAt }) => new Date(expiresAt).getTime() <= now);
  const temp = communityTempStore();
  await Promise.all(expiredUploads.map(async (upload) => {
    await Promise.all(Array.from({ length: upload.expectedChunks }, (_, index) =>
      temp.delete(`uploads/${upload.id}/${index}`)));
    await deleteUpload(upload.id);
  }));
}

export const config: Config = {
  schedule: "@daily"
};
