import {
  findReply,
  getAttachment,
  getPost,
  listReactions,
  listReplies
} from "./community-data.js";
import { publicAuthor, REACTION_KINDS, type CommunityPostRecord, type CommunityReplyRecord } from "./community.js";
import { getUserById } from "./data.js";

export async function reactionView(targetType: "post" | "reply", targetId: string, viewerId: string) {
  const reactions = await listReactions(targetType, targetId);
  return Object.fromEntries(REACTION_KINDS.map((kind) => [
    kind,
    {
      count: reactions.filter(({ reaction }) => reaction === kind).length,
      reacted: reactions.some(({ reaction, userId }) => reaction === kind && userId === viewerId)
    }
  ]));
}

export async function attachmentView(id: string) {
  const attachment = await getAttachment(id);
  if (!attachment || attachment.deletedAt) return null;
  return {
    id: attachment.id,
    filename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    width: attachment.width,
    height: attachment.height,
    altText: attachment.altText || "Community image",
    imageUrl: `/api/community/images/${attachment.id}`,
    thumbnailUrl: `/api/community/images/${attachment.id}?variant=thumbnail`
  };
}

export async function replyView(reply: CommunityReplyRecord, viewerId: string) {
  const author = await getUserById(reply.authorId);
  return {
    id: reply.id,
    postId: reply.postId,
    parentReplyId: reply.parentReplyId,
    depth: reply.depth,
    author: author ? publicAuthor(author) : null,
    body: reply.status === "active" ? reply.body : "",
    status: reply.status,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
    editedAt: reply.editedAt,
    reactions: await reactionView("reply", reply.id, viewerId),
    canEdit: reply.authorId === viewerId && reply.status === "active"
  };
}

export async function postView(post: CommunityPostRecord, viewerId: string, includeReplies = false) {
  const [author, attachmentValues, reactions, replies] = await Promise.all([
    getUserById(post.authorId),
    Promise.all(post.attachmentIds.map(attachmentView)),
    reactionView("post", post.id, viewerId),
    listReplies(post.id)
  ]);
  const activeReplies = replies.filter(({ status }) => status === "active");
  return {
    id: post.id,
    author: author ? publicAuthor(author) : null,
    title: post.status === "active" ? post.title : "Discussion unavailable",
    body: post.status === "active" ? post.body : "",
    category: post.category,
    courseId: post.courseId,
    attachments: attachmentValues.filter(Boolean),
    acceptedReplyId: post.acceptedReplyId,
    resolvedAt: post.resolvedAt,
    lockedAt: post.lockedAt,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    activityAt: post.activityAt,
    editedAt: post.editedAt,
    replyCount: activeReplies.length,
    reactions,
    canEdit: post.authorId === viewerId && post.status === "active" && !post.lockedAt,
    ...(includeReplies
      ? { replies: await Promise.all(replies.map((reply) => replyView(reply, viewerId))) }
      : {})
  };
}

export async function targetPostId(targetType: "post" | "reply", targetId: string): Promise<string | null> {
  if (targetType === "post") return (await getPost(targetId))?.id || null;
  return (await findReply(targetId))?.postId || null;
}
