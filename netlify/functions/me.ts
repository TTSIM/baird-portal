import type { Config } from "@netlify/functions";
import { jsonError, requireUser } from "./_shared/auth.js";
import { buildPortalView, courseIdsForGrants } from "./_shared/course-catalog.js";
import { hasFullCourseAccess } from "./_shared/roles.js";
import { communityEnabled, publicAuthor } from "./_shared/community.js";

export default async function handler(request: Request) {
  if (request.method !== "GET") {
    return Response.json({ error: "Only GET is accepted." }, { status: 405, headers: { Allow: "GET" } });
  }

  try {
    const user = await requireUser(request);
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        grants: user.grants,
        profileComplete: Boolean(user.profileCompletedAt),
        profile: publicAuthor(user),
        notificationPreferences: user.notificationPreferences,
        eligibleCourseIds: hasFullCourseAccess(user.role) ? undefined : courseIdsForGrants(user.grants)
      },
      features: { community: communityEnabled() },
      portal: buildPortalView(user)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/me",
  method: "GET"
};
