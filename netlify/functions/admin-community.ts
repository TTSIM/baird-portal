import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireStaff } from "./_shared/auth.js";
import { cleanOptionalText, requireSameOrigin, type CommunityTargetType } from "./_shared/community.js";
import {
  deleteAttachmentContent,
  findReply,
  getAttachment,
  getPost,
  listAllReplies,
  listModeration,
  listPosts,
  listReports,
  markReportsReviewed,
  newId,
  saveModeration,
  saveNotification,
  savePost,
  saveReply
} from "./_shared/community-data.js";
import { queueCommunityEmail, sendCommunityEmail } from "./_shared/community-email.js";
import { getUserById } from "./_shared/data.js";

async function adminView() {
  const [reports, posts, replies, moderation] = await Promise.all([
    listReports("open"),
    listPosts(),
    listAllReplies(),
    listModeration()
  ]);
  const reportViews = await Promise.all(reports.map(async (report) => {
    const [reporter, post, reply] = await Promise.all([
      getUserById(report.reporterId),
      getPost(report.postId),
      report.targetType === "reply" ? findReply(report.targetId) : Promise.resolve(null)
    ]);
    const attachments = post
      ? (await Promise.all(post.attachmentIds.map(getAttachment)))
        .filter((attachment) => attachment && !attachment.deletedAt)
        .map((attachment) => ({ id: attachment!.id, filename: attachment!.originalFilename }))
      : [];
    return {
      ...report,
      reporter: reporter ? { id: reporter.id, name: reporter.name, email: reporter.email } : null,
      target: report.targetType === "post"
        ? { title: post?.title || "Missing discussion", body: post?.body || "", status: post?.status, attachments }
        : { title: post?.title || "Missing discussion", body: reply?.body || "", status: reply?.status, attachments: [] }
    };
  }));
  const moderationViews = await Promise.all(moderation.slice(0, 100).map(async (record) => {
    const actor = await getUserById(record.actorId);
    return { ...record, actor: actor ? { id: actor.id, name: actor.name } : null };
  }));
  const postContent = posts
    .filter((post) => post.status !== "active" || post.lockedAt)
    .map((post) => ({
      targetType: "post" as const,
      id: post.id,
      title: post.title,
      status: post.status,
      lockedAt: post.lockedAt,
      updatedAt: post.updatedAt
    }));
  const replyContent = replies
    .filter((reply) => reply.status !== "active")
    .map((reply) => ({
      targetType: "reply" as const,
      id: reply.id,
      title: `Reply in ${posts.find(({ id }) => id === reply.postId)?.title || "missing discussion"}`,
      status: reply.status,
      updatedAt: reply.updatedAt
    }));
  return {
    reports: reportViews,
    content: [...postContent, ...replyContent].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    moderation: moderationViews
  };
}

async function notifyModeration(
  authorId: string,
  actorId: string,
  postId: string,
  targetId: string,
  request: Request,
  context: Context
) {
  if (authorId === actorId) return;
  const author = await getUserById(authorId);
  if (!author) return;
  await saveNotification({
    id: newId(),
    userId: author.id,
    actorId,
    kind: "moderation",
    postId,
    targetId,
    createdAt: new Date().toISOString()
  });
  const job = await queueCommunityEmail(author, "moderation", postId);
  if (job) context.waitUntil(sendCommunityEmail(job, new URL(request.url).origin));
}

export default async function handler(request: Request, context: Context) {
  try {
    const staff = await requireStaff(request);
    if (request.method === "GET") {
      return Response.json(await adminView(), { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "PATCH") {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, PATCH" } });
    }
    requireSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const targetType = body.targetType as CommunityTargetType | "attachment";
    const targetId = typeof body.targetId === "string" ? body.targetId : "";
    const allowed = ["hide", "restore", "lock", "unlock", "delete", "remove-image"];
    if (typeof action !== "string" || !allowed.includes(action) || !targetId) {
      throw new HttpError(400, "Choose a valid moderation action.", "INVALID_ACTION");
    }
    const reason = cleanOptionalText(body.reason, 500);
    const now = new Date().toISOString();
    let authorId = "";
    let postId = "";

    if (targetType === "post") {
      const post = await getPost(targetId);
      if (!post) throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
      authorId = post.authorId;
      postId = post.id;
      if (action === "hide") await savePost({ ...post, status: "hidden", hiddenAt: now, updatedAt: now });
      if (action === "restore") {
        await savePost({ ...post, status: "active", hiddenAt: undefined, deletedAt: undefined, updatedAt: now });
      }
      if (action === "lock") await savePost({ ...post, lockedAt: now, updatedAt: now });
      if (action === "unlock") await savePost({ ...post, lockedAt: undefined, updatedAt: now });
      if (action === "delete") await savePost({ ...post, status: "deleted", deletedAt: now, updatedAt: now });
    } else if (targetType === "reply") {
      const reply = await findReply(targetId);
      if (!reply) throw new HttpError(404, "Reply not found.", "REPLY_NOT_FOUND");
      authorId = reply.authorId;
      postId = reply.postId;
      if (action === "hide") await saveReply({ ...reply, status: "hidden", hiddenAt: now, updatedAt: now });
      if (action === "restore") {
        await saveReply({ ...reply, status: "active", hiddenAt: undefined, deletedAt: undefined, updatedAt: now });
      }
      if (action === "delete") await saveReply({ ...reply, status: "deleted", deletedAt: now, updatedAt: now });
      if (action === "lock" || action === "unlock") {
        throw new HttpError(400, "Only discussions can be locked.", "INVALID_ACTION");
      }
    } else if (targetType === "attachment" && action === "remove-image") {
      const attachment = await getAttachment(targetId);
      if (!attachment) throw new HttpError(404, "Image not found.", "IMAGE_NOT_FOUND");
      authorId = attachment.ownerId;
      postId = attachment.attachedTo?.type === "post" ? attachment.attachedTo.id : "";
      await deleteAttachmentContent(attachment);
    } else {
      throw new HttpError(400, "The moderation target is invalid.", "INVALID_TARGET");
    }

    await saveModeration({
      id: newId(),
      actorId: staff.id,
      action: action as "hide" | "restore" | "lock" | "unlock" | "delete" | "remove-image",
      targetType,
      targetId,
      reason,
      createdAt: now
    });
    if (targetType === "post" || targetType === "reply") {
      await markReportsReviewed(targetType, targetId, staff.id);
    }
    if (authorId && postId) context.waitUntil(notifyModeration(authorId, staff.id, postId, targetId, request, context));
    return Response.json(await adminView(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/admin/community",
  method: ["GET", "PATCH"]
};
