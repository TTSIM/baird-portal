import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import {
  cleanOptionalText,
  cleanReaction,
  cleanReportReason,
  publicAuthor,
  requireCommunityEnabled,
  requireCompleteProfile,
  requireSameOrigin,
  type CommunityTargetType
} from "./_shared/community.js";
import {
  consumeCommunityRate,
  deleteReaction,
  findReply,
  getPost,
  getReportForUser,
  listNotifications,
  listReactions,
  markNotificationsRead,
  newId,
  saveNotification,
  savePost,
  saveReport,
  setReaction
} from "./_shared/community-data.js";
import { postView, reactionView } from "./_shared/community-view.js";
import { queueCommunityEmail, sendCommunityEmail } from "./_shared/community-email.js";
import { getUserById, listUsers } from "./_shared/data.js";
import { isStaffRole } from "./_shared/roles.js";

async function resolveTarget(targetType: CommunityTargetType, targetId: string) {
  if (targetType === "post") {
    const post = await getPost(targetId);
    if (!post || post.status !== "active") throw new HttpError(404, "Discussion not found.", "TARGET_NOT_FOUND");
    return { postId: post.id, authorId: post.authorId };
  }
  const reply = await findReply(targetId);
  if (!reply || reply.status !== "active") throw new HttpError(404, "Reply not found.", "TARGET_NOT_FOUND");
  return { postId: reply.postId, authorId: reply.authorId };
}

async function react(request: Request, context: Context, user: Awaited<ReturnType<typeof requireUser>>) {
  const targetType = context.params.targetType as CommunityTargetType;
  if (targetType !== "post" && targetType !== "reply") {
    throw new HttpError(400, "The reaction target is invalid.", "INVALID_TARGET");
  }
  const targetId = context.params.targetId;
  const reaction = cleanReaction(context.params.reaction);
  const target = await resolveTarget(targetType, targetId);
  await consumeCommunityRate("reaction", user.id, 120, 60 * 60 * 1_000);
  if (request.method === "PUT") {
    const existing = (await listReactions(targetType, targetId))
      .some((item) => item.userId === user.id && item.reaction === reaction);
    await setReaction({
      targetType,
      targetId,
      postId: target.postId,
      userId: user.id,
      reaction,
      createdAt: new Date().toISOString()
    });
    if (!existing && target.authorId !== user.id) {
      context.waitUntil(saveNotification({
        id: newId(),
        userId: target.authorId,
        actorId: user.id,
        kind: "reaction",
        postId: target.postId,
        targetId,
        createdAt: new Date().toISOString()
      }));
    }
  } else {
    await deleteReaction(targetType, targetId, reaction, user.id);
  }
  return Response.json({ reactions: await reactionView(targetType, targetId, user.id) }, {
    headers: { "Cache-Control": "no-store" }
  });
}

async function report(request: Request, user: Awaited<ReturnType<typeof requireUser>>) {
  const body = await request.json() as Record<string, unknown>;
  const targetType = body.targetType as CommunityTargetType;
  const targetId = typeof body.targetId === "string" ? body.targetId : "";
  if ((targetType !== "post" && targetType !== "reply") || !targetId) {
    throw new HttpError(400, "The report target is invalid.", "INVALID_TARGET");
  }
  const target = await resolveTarget(targetType, targetId);
  if (target.authorId === user.id) throw new HttpError(400, "You cannot report your own content.", "INVALID_REPORT");
  if (await getReportForUser(targetType, targetId, user.id)) {
    throw new HttpError(409, "You have already reported this content.", "ALREADY_REPORTED");
  }
  const reportRecord = {
    id: newId(),
    targetType,
    targetId,
    postId: target.postId,
    reporterId: user.id,
    reason: cleanReportReason(body.reason),
    details: cleanOptionalText(body.details, 500),
    status: "open" as const,
    createdAt: new Date().toISOString()
  };
  await saveReport(reportRecord);
  return Response.json({ report: { id: reportRecord.id, status: reportRecord.status } }, {
    status: 201,
    headers: { "Cache-Control": "no-store" }
  });
}

async function acceptReply(
  request: Request,
  context: Context,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  const post = await getPost(context.params.postId);
  if (!post || post.status !== "active") throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
  if (post.authorId !== user.id && !isStaffRole(user.role)) {
    throw new HttpError(403, "Only the author or an administrator can accept an answer.", "FORBIDDEN");
  }
  const body = await request.json() as Record<string, unknown>;
  const replyId = body.replyId === null || body.replyId === "" ? undefined
    : typeof body.replyId === "string" ? body.replyId : null;
  if (replyId === null) throw new HttpError(400, "Choose a valid reply.", "INVALID_REPLY");
  let reply = null;
  if (replyId) {
    reply = await findReply(replyId);
    if (!reply || reply.postId !== post.id || reply.status !== "active") {
      throw new HttpError(404, "Reply not found.", "REPLY_NOT_FOUND");
    }
  }
  const now = new Date().toISOString();
  const saved = {
    ...post,
    acceptedReplyId: reply?.id,
    resolvedAt: reply ? now : undefined,
    updatedAt: now,
    activityAt: now
  };
  await savePost(saved);
  if (reply && reply.authorId !== user.id && reply.id !== post.acceptedReplyId) {
    context.waitUntil((async () => {
      const recipient = await getUserById(reply.authorId);
      if (!recipient) return;
      await saveNotification({
        id: newId(),
        userId: recipient.id,
        actorId: user.id,
        kind: "accepted-answer",
        postId: post.id,
        targetId: reply.id,
        createdAt: now
      });
      const job = await queueCommunityEmail(recipient, "accepted-answer", post.id);
      if (job) await sendCommunityEmail(job, new URL(request.url).origin);
    })());
  }
  return Response.json({ post: await postView(saved, user.id, true) }, { headers: { "Cache-Control": "no-store" } });
}

async function notifications(request: Request, user: Awaited<ReturnType<typeof requireUser>>) {
  if (request.method === "PATCH") {
    const body = await request.json() as Record<string, unknown>;
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : undefined;
    await markNotificationsRead(user.id, ids);
  }
  const records = (await listNotifications(user.id)).slice(0, 100);
  const values = await Promise.all(records.map(async (notification) => {
    const actor = notification.actorId ? await getUserById(notification.actorId) : null;
    return { ...notification, actor: actor ? publicAuthor(actor) : null };
  }));
  return Response.json({
    notifications: values,
    unreadCount: values.filter(({ readAt }) => !readAt).length
  }, { headers: { "Cache-Control": "no-store" } });
}

async function members(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") || "").trim().toLocaleLowerCase();
  const users = (await listUsers())
    .filter(({ active, profileCompletedAt, name }) =>
      active && profileCompletedAt && (!query || name.toLocaleLowerCase().includes(query)))
    .slice(0, 8)
    .map(publicAuthor);
  return Response.json({ members: users }, { headers: { "Cache-Control": "no-store" } });
}

export default async function handler(request: Request, context: Context) {
  try {
    requireCommunityEnabled();
    const user = requireCompleteProfile(await requireUser(request));
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/community/notifications") return await notifications(request, user);
    if (request.method === "GET" && path === "/api/community/members") return await members(request);
    requireSameOrigin(request);
    if ((request.method === "PUT" || request.method === "DELETE") && context.params.targetType) {
      return await react(request, context, user);
    }
    if (request.method === "POST" && path === "/api/community/reports") return await report(request, user);
    if (request.method === "PATCH" && context.params.postId) return await acceptReply(request, context, user);
    if (request.method === "PATCH" && path === "/api/community/notifications") return await notifications(request, user);
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: [
    "/api/community/reactions/:targetType/:targetId/:reaction",
    "/api/community/reports",
    "/api/community/posts/:postId/accepted-reply",
    "/api/community/notifications",
    "/api/community/members"
  ],
  method: ["GET", "POST", "PUT", "PATCH", "DELETE"]
};
