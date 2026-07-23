import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import {
  cleanRequiredText,
  MAX_REPLY_BODY,
  nextReplyDepth,
  requireCommunityEnabled,
  requireCompleteProfile,
  requireSameOrigin,
  type CommunityReplyRecord
} from "./_shared/community.js";
import {
  consumeCommunityRate,
  findReply,
  getPost,
  newId,
  saveNotification,
  savePost,
  saveReply
} from "./_shared/community-data.js";
import { postView, replyView } from "./_shared/community-view.js";
import { queueCommunityEmail, sendCommunityEmail } from "./_shared/community-email.js";
import { getUserById, listUsers } from "./_shared/data.js";

async function notifyUser(
  userId: string,
  actorId: string,
  kind: "reply" | "mention",
  postId: string,
  targetId: string,
  baseUrl: string
) {
  if (userId === actorId) return;
  const user = await getUserById(userId);
  if (!user?.active || !user.profileCompletedAt) return;
  await saveNotification({
    id: newId(),
    userId,
    actorId,
    kind,
    postId,
    targetId,
    createdAt: new Date().toISOString()
  });
  const job = await queueCommunityEmail(user, kind, postId);
  if (job) await sendCommunityEmail(job, baseUrl);
}

async function createReply(
  request: Request,
  context: Context,
  postId: string,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  await consumeCommunityRate("reply", user.id, 60, 60 * 60 * 1_000);
  const post = await getPost(postId);
  if (!post || post.status !== "active") throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
  if (post.lockedAt) throw new HttpError(409, "This discussion is locked.", "POST_LOCKED");
  const body = await request.json() as Record<string, unknown>;
  const content = cleanRequiredText(body.body, "Reply", MAX_REPLY_BODY);
  let parent: CommunityReplyRecord | null = null;
  if (body.parentReplyId !== undefined && body.parentReplyId !== null && body.parentReplyId !== "") {
    if (typeof body.parentReplyId !== "string") throw new HttpError(400, "The parent reply is invalid.", "INVALID_PARENT");
    parent = await findReply(body.parentReplyId);
    if (!parent || parent.postId !== post.id || parent.status !== "active") {
      throw new HttpError(404, "The parent reply was not found.", "PARENT_NOT_FOUND");
    }
  }
  const depth = nextReplyDepth(parent?.depth);
  const now = new Date().toISOString();
  const reply: CommunityReplyRecord = {
    id: newId(),
    postId: post.id,
    parentReplyId: parent?.id,
    depth,
    authorId: user.id,
    body: content,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  await saveReply(reply);
  await savePost({ ...post, activityAt: now, updatedAt: now });
  const baseUrl = new URL(request.url).origin;
  context.waitUntil((async () => {
    const directRecipients = new Set([post.authorId, ...(parent ? [parent.authorId] : [])]);
    await Promise.all([...directRecipients].map((id) =>
      notifyUser(id, user.id, "reply", post.id, reply.id, baseUrl)));
    const lowerContent = content.toLocaleLowerCase();
    const mentioned = (await listUsers()).filter(({ id, active, name }) =>
      id !== user.id && active && lowerContent.includes(`@${name.toLocaleLowerCase()}`));
    await Promise.all(mentioned.filter(({ id }) => !directRecipients.has(id)).map(({ id }) =>
      notifyUser(id, user.id, "mention", post.id, reply.id, baseUrl)));
  })());
  return Response.json({
    reply: await replyView(reply, user.id),
    post: await postView({ ...post, activityAt: now, updatedAt: now }, user.id, true)
  }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

async function updateReply(
  request: Request,
  id: string,
  user: Awaited<ReturnType<typeof requireUser>>
) {
  const reply = await findReply(id);
  if (!reply) throw new HttpError(404, "Reply not found.", "REPLY_NOT_FOUND");
  if (reply.authorId !== user.id) throw new HttpError(403, "Only the author can edit this reply.", "FORBIDDEN");
  const post = await getPost(reply.postId);
  if (!post || post.lockedAt || reply.status !== "active") {
    throw new HttpError(409, "This reply cannot be edited.", "REPLY_LOCKED");
  }
  const body = await request.json() as Record<string, unknown>;
  const now = new Date().toISOString();
  const saved = {
    ...reply,
    body: cleanRequiredText(body.body, "Reply", MAX_REPLY_BODY),
    updatedAt: now,
    editedAt: now
  };
  await saveReply(saved);
  return Response.json({ reply: await replyView(saved, user.id) }, { headers: { "Cache-Control": "no-store" } });
}

async function deleteReply(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const reply = await findReply(id);
  if (!reply) throw new HttpError(404, "Reply not found.", "REPLY_NOT_FOUND");
  if (reply.authorId !== user.id) throw new HttpError(403, "Only the author can delete this reply.", "FORBIDDEN");
  const now = new Date().toISOString();
  await saveReply({ ...reply, status: "deleted", deletedAt: now, updatedAt: now });
  return new Response(null, { status: 204 });
}

export default async function handler(request: Request, context: Context) {
  try {
    requireCommunityEnabled();
    const user = requireCompleteProfile(await requireUser(request));
    requireSameOrigin(request);
    if (request.method === "POST" && context.params.postId) {
      return await createReply(request, context, context.params.postId, user);
    }
    if (request.method === "PATCH" && context.params.id) return await updateReply(request, context.params.id, user);
    if (request.method === "DELETE" && context.params.id) return await deleteReply(context.params.id, user);
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: ["/api/community/posts/:postId/replies", "/api/community/replies/:id"],
  method: ["POST", "PATCH", "DELETE"]
};
