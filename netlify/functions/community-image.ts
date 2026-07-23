import type { Config, Context } from "@netlify/functions";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import { communityImagesStore, getAttachment, getPost } from "./_shared/community-data.js";
import { isStaffRole } from "./_shared/roles.js";

export default async function handler(request: Request, context: Context) {
  try {
    if (request.method !== "GET") {
      return Response.json({ error: "Only GET is accepted." }, { status: 405, headers: { Allow: "GET" } });
    }
    const user = await requireUser(request);
    const attachment = await getAttachment(context.params.id);
    if (!attachment || attachment.deletedAt) {
      throw new HttpError(404, "Image not found.", "IMAGE_NOT_FOUND");
    }
    if (!attachment.attachedTo && attachment.ownerId !== user.id && !isStaffRole(user.role)) {
      throw new HttpError(403, "You cannot access this image.", "FORBIDDEN");
    }
    if (attachment.attachedTo?.type === "post") {
      const post = await getPost(attachment.attachedTo.id);
      if (!post || (post.status !== "active" && post.authorId !== user.id && !isStaffRole(user.role))) {
        throw new HttpError(404, "Image not found.", "IMAGE_NOT_FOUND");
      }
    }
    const thumbnail = new URL(request.url).searchParams.get("variant") === "thumbnail";
    const stream = await communityImagesStore().get(
      thumbnail ? attachment.thumbnailKey : attachment.imageKey,
      { type: "stream" }
    ) as ReadableStream | null;
    if (!stream) throw new HttpError(404, "Image not found.", "IMAGE_NOT_FOUND");
    return new Response(stream, {
      headers: {
        "Content-Type": thumbnail ? "image/webp" : attachment.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/community/images/:id",
  method: "GET"
};
