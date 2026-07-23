import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import { allCourseIds } from "./_shared/course-catalog.js";
import {
  COMMUNITY_PAGE_SIZE,
  cleanCategory,
  cleanRequiredText,
  decodeCursor,
  encodeCursor,
  MAX_POST_BODY,
  MAX_POST_TITLE,
  requireCommunityEnabled,
  requireCompleteProfile,
  requireSameOrigin,
  validatePostImageCount,
  type CommunityPostRecord
} from "./_shared/community.js";
import {
  consumeCommunityRate,
  getAttachment,
  getPost,
  listFeedPosts,
  newId,
  saveAttachment,
  saveNotification,
  savePost
} from "./_shared/community-data.js";
import { postView } from "./_shared/community-view.js";
import { queueCommunityEmail, sendCommunityEmail } from "./_shared/community-email.js";
import { getUserById, listUsers } from "./_shared/data.js";
import { isStaffRole } from "./_shared/roles.js";

function cleanCourseId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !allCourseIds.has(value)) {
    throw new HttpError(400, "Choose a valid course.", "INVALID_COURSE");
  }
  return value;
}

async function notifyMentions(
  body: string,
  actorId: string,
  postId: string,
  baseUrl: string,
  context: Context
) {
  const users = (await listUsers()).filter(({ active, id, profileCompletedAt }) =>
    active && id !== actorId && profileCompletedAt);
  const lowerBody = body.toLocaleLowerCase();
  const mentioned = users.filter(({ name }) => lowerBody.includes(`@${name.toLocaleLowerCase()}`));
  await Promise.all(mentioned.map(async (user) => {
    const now = new Date().toISOString();
    await saveNotification({
      id: newId(),
      userId: user.id,
      actorId,
      kind: "mention",
      postId,
      createdAt: now
    });
    const job = await queueCommunityEmail(user, "mention", postId);
    if (job) context.waitUntil(sendCommunityEmail(job, baseUrl));
  }));
}

async function createPost(request: Request, context: Context, user: Awaited<ReturnType<typeof requireUser>>) {
  await consumeCommunityRate("post", user.id, 10, 60 * 60 * 1_000);
  const body = await request.json() as Record<string, unknown>;
  const title = cleanRequiredText(body.title, "Title", MAX_POST_TITLE);
  const content = cleanRequiredText(body.body, "Question", MAX_POST_BODY);
  const category = cleanCategory(body.category);
  const courseId = cleanCourseId(body.courseId);
  const files = Array.isArray(body.attachments) ? body.attachments : [];
  validatePostImageCount(files);
  if (category === "case-support" && body.caseAttestation !== true) {
    throw new HttpError(
      400,
      "Confirm patient confidentiality and your authority to share this case.",
      "CASE_ATTESTATION_REQUIRED"
    );
  }
  const uniqueIds = new Set<string>();
  const attachments = await Promise.all(files.map(async (value) => {
    if (!value || typeof value !== "object") throw new HttpError(400, "An attachment is invalid.", "INVALID_ATTACHMENT");
    const entry = value as Record<string, unknown>;
    if (typeof entry.id !== "string" || uniqueIds.has(entry.id)) {
      throw new HttpError(400, "An attachment is invalid.", "INVALID_ATTACHMENT");
    }
    uniqueIds.add(entry.id);
    const attachment = await getAttachment(entry.id);
    if (!attachment || attachment.ownerId !== user.id || attachment.purpose !== "post"
      || attachment.attachedTo || attachment.deletedAt) {
      throw new HttpError(404, "An uploaded image was not found.", "ATTACHMENT_NOT_FOUND");
    }
    return { ...attachment, altText: cleanRequiredText(entry.altText, "Image description", 300) };
  }));

  const now = new Date().toISOString();
  const post: CommunityPostRecord = {
    id: newId(),
    authorId: user.id,
    title,
    body: content,
    category,
    courseId,
    attachmentIds: attachments.map(({ id }) => id),
    caseAttestationAt: category === "case-support" ? now : undefined,
    status: "active",
    createdAt: now,
    updatedAt: now,
    activityAt: now
  };
  await savePost(post);
  await Promise.all(attachments.map((attachment) =>
    saveAttachment({ ...attachment, attachedTo: { type: "post", id: post.id } })));
  context.waitUntil(notifyMentions(content, user.id, post.id, new URL(request.url).origin, context));
  return Response.json({ post: await postView(post, user.id, true) }, {
    status: 201,
    headers: { "Cache-Control": "no-store" }
  });
}

async function listFeed(request: Request, user: Awaited<ReturnType<typeof requireUser>>) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const courseId = url.searchParams.get("courseId");
  const status = url.searchParams.get("status") || "latest";
  if (category && category !== "all") cleanCategory(category);
  if (courseId && !allCourseIds.has(courseId)) throw new HttpError(400, "Choose a valid course.", "INVALID_COURSE");
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  let posts = (await listFeedPosts())
    .filter((post) => post.status === "active")
    .filter((post) => !category || category === "all" || post.category === category)
    .filter((post) => !courseId || post.courseId === courseId)
    .filter((post) => status !== "resolved" || Boolean(post.resolvedAt))
    .filter((post) => status !== "unanswered" || !post.resolvedAt)
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt) || b.id.localeCompare(a.id));
  if (status === "unanswered") {
    const withViews = await Promise.all(posts.map((post) => postView(post, user.id)));
    const unanswered = withViews.filter(({ replyCount }) => replyCount === 0);
    const start = cursor ? Math.max(0, unanswered.findIndex(({ id }) => id === cursor.id) + 1) : 0;
    const page = unanswered.slice(start, start + COMMUNITY_PAGE_SIZE);
    const source = posts.find(({ id }) => id === page.at(-1)?.id);
    return Response.json({
      posts: page,
      nextCursor: page.length === COMMUNITY_PAGE_SIZE && source
        ? encodeCursor({ activityAt: source.activityAt, id: source.id })
        : null
    }, { headers: { "Cache-Control": "no-store" } });
  }
  const start = cursor ? Math.max(0, posts.findIndex(({ id }) => id === cursor.id) + 1) : 0;
  const page = posts.slice(start, start + COMMUNITY_PAGE_SIZE);
  return Response.json({
    posts: await Promise.all(page.map((post) => postView(post, user.id))),
    nextCursor: page.length === COMMUNITY_PAGE_SIZE
      ? encodeCursor({ activityAt: page.at(-1)!.activityAt, id: page.at(-1)!.id })
      : null
  }, { headers: { "Cache-Control": "no-store" } });
}

async function getThread(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const post = await getPost(id);
  if (!post || (post.status !== "active" && post.authorId !== user.id && !isStaffRole(user.role))) {
    throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
  }
  return Response.json({ post: await postView(post, user.id, true) }, {
    headers: { "Cache-Control": "no-store" }
  });
}

async function updatePost(request: Request, id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const post = await getPost(id);
  if (!post) throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
  if (post.authorId !== user.id) throw new HttpError(403, "Only the author can edit this discussion.", "FORBIDDEN");
  if (post.status !== "active" || post.lockedAt) {
    throw new HttpError(409, "This discussion cannot be edited.", "POST_LOCKED");
  }
  const body = await request.json() as Record<string, unknown>;
  const category = body.category === undefined ? post.category : cleanCategory(body.category);
  if (category === "case-support" && !post.caseAttestationAt && body.caseAttestation !== true) {
    throw new HttpError(400, "Confirm patient confidentiality before changing this to a case discussion.", "CASE_ATTESTATION_REQUIRED");
  }
  const now = new Date().toISOString();
  const saved: CommunityPostRecord = {
    ...post,
    title: body.title === undefined ? post.title : cleanRequiredText(body.title, "Title", MAX_POST_TITLE),
    body: body.body === undefined ? post.body : cleanRequiredText(body.body, "Question", MAX_POST_BODY),
    category,
    courseId: body.courseId === undefined ? post.courseId : cleanCourseId(body.courseId),
    caseAttestationAt: category === "case-support" ? post.caseAttestationAt || now : undefined,
    updatedAt: now,
    editedAt: now
  };
  await savePost(saved);
  return Response.json({ post: await postView(saved, user.id, true) }, { headers: { "Cache-Control": "no-store" } });
}

async function deletePost(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
  const post = await getPost(id);
  if (!post) throw new HttpError(404, "Discussion not found.", "POST_NOT_FOUND");
  if (post.authorId !== user.id) throw new HttpError(403, "Only the author can delete this discussion.", "FORBIDDEN");
  const now = new Date().toISOString();
  await savePost({ ...post, status: "deleted", deletedAt: now, updatedAt: now });
  return new Response(null, { status: 204 });
}

export default async function handler(request: Request, context: Context) {
  try {
    requireCommunityEnabled();
    const user = requireCompleteProfile(await requireUser(request));
    const id = context.params.id;
    if (request.method === "GET") return id ? await getThread(id, user) : await listFeed(request, user);
    requireSameOrigin(request);
    if (request.method === "POST" && !id) return await createPost(request, context, user);
    if (request.method === "PATCH" && id) return await updatePost(request, id, user);
    if (request.method === "DELETE" && id) return await deletePost(id, user);
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: ["/api/community/posts", "/api/community/posts/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"]
};
