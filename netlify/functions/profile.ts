import type { Config } from "@netlify/functions";
import { HttpError, jsonError, requireUser } from "./_shared/auth.js";
import { getAttachment, saveAttachment } from "./_shared/community-data.js";
import { cleanOptionalText, cleanRequiredText, requireSameOrigin } from "./_shared/community.js";
import { saveUser } from "./_shared/data.js";

function profileView(user: Awaited<ReturnType<typeof requireUser>>) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    location: user.location || "",
    role: user.role,
    avatar: user.avatar,
    googlePictureUrl: user.googlePictureUrl,
    profileCompletedAt: user.profileCompletedAt,
    completedCourseIds: user.completedCourseIds || [],
    notificationPreferences: user.notificationPreferences || {
      emailReplies: true,
      emailMentions: true,
      emailAcceptedAnswers: true
    }
  };
}

export default async function handler(request: Request) {
  try {
    const user = await requireUser(request);
    if (request.method === "GET") {
      return Response.json({ profile: profileView(user) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "PATCH") {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "GET, PATCH" } });
    }

    requireSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const name = cleanRequiredText(body.name, "Name", 80);
    const location = cleanOptionalText(body.location, 100);
    const avatarChoice = body.avatarChoice;
    let avatar = user.avatar;

    if (avatarChoice === "none") avatar = undefined;
    if (avatarChoice === "google") {
      if (!user.googlePictureUrl) throw new HttpError(400, "A Google profile picture is not available.", "NO_GOOGLE_AVATAR");
      avatar = { kind: "google", url: user.googlePictureUrl };
    }
    if (avatarChoice === "upload") {
      if (typeof body.avatarAssetId !== "string") {
        throw new HttpError(400, "Upload a profile picture first.", "MISSING_AVATAR");
      }
      const attachment = await getAttachment(body.avatarAssetId);
      if (!attachment || attachment.ownerId !== user.id || attachment.purpose !== "avatar" || attachment.deletedAt) {
        throw new HttpError(404, "The uploaded profile picture was not found.", "AVATAR_NOT_FOUND");
      }
      await saveAttachment({ ...attachment, attachedTo: { type: "avatar", id: user.id } });
      avatar = { kind: "upload", assetId: attachment.id };
    }

    const preferences = typeof body.notificationPreferences === "object" && body.notificationPreferences
      ? body.notificationPreferences as Record<string, unknown>
      : {};
    const saved = await saveUser({
      ...user,
      name,
      location,
      avatar,
      profileCompletedAt: user.profileCompletedAt || new Date().toISOString(),
      completedCourseIds: user.completedCourseIds || [],
      notificationPreferences: {
        emailReplies: preferences.emailReplies !== false,
        emailMentions: preferences.emailMentions !== false,
        emailAcceptedAnswers: preferences.emailAcceptedAnswers !== false
      }
    });
    return Response.json({ profile: profileView(saved) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/profile",
  method: ["GET", "PATCH"]
};
