import type { Config } from "@netlify/functions";
import { OAuth2Client } from "google-auth-library";
import { bootstrapAdminEmails, bootstrapOwnerEmails, env, requiredEnv } from "./_shared/env.js";
import { createUser, getUserByEmail, saveUser } from "./_shared/data.js";
import { HttpError, jsonError } from "./_shared/auth.js";
import { cookieValue, CSRF_COOKIE, SESSION_DURATION_SECONDS, sessionCookie, signSession } from "./_shared/session.js";
import { bootstrappedRole } from "./_shared/roles.js";

type LoginBody = { credential?: unknown; csrfToken?: unknown };

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Only POST is accepted." }, { status: 405, headers: { Allow: "POST" } });
  }

  try {
    const body = await request.json() as LoginBody;
    const csrfFromCookie = cookieValue(request, CSRF_COOKIE);
    const csrfFromRequest = typeof body.csrfToken === "string"
      ? body.csrfToken
      : request.headers.get("x-csrf-token");
    if (!csrfFromRequest || !csrfFromCookie || csrfFromCookie !== csrfFromRequest) {
      throw new HttpError(403, "The sign-in request could not be verified.", "INVALID_CSRF");
    }
    if (typeof body.credential !== "string" || !body.credential) {
      throw new HttpError(400, "Google did not return a valid credential.", "INVALID_CREDENTIAL");
    }

    const googleClientId = requiredEnv("GOOGLE_CLIENT_ID");
    const ticket = await new OAuth2Client().verifyIdToken({
      idToken: body.credential,
      audience: googleClientId
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.trim().toLowerCase();
    const googleSub = payload?.sub;
    if (!email || !googleSub || !payload?.email_verified) {
      throw new HttpError(403, "Use a verified Google account to sign in.", "UNVERIFIED_ACCOUNT");
    }

    let user = await getUserByEmail(email);
    const bootstrapRole = bootstrappedRole(email, bootstrapOwnerEmails(), bootstrapAdminEmails());
    const bootstrapOwner = bootstrapRole === "owner";
    if (!user && bootstrapRole) {
      user = await createUser({
        email,
        name: payload.name || email,
        role: bootstrapRole,
        grants: [],
        googleSub
      });
    }
    if (!user) {
      throw new HttpError(403, "This Google account has not been approved for the BAIRD portal.", "NOT_APPROVED");
    }
    if (user.googleSub && user.googleSub !== googleSub) {
      throw new HttpError(403, "This Google account does not match the approved account.", "ACCOUNT_MISMATCH");
    }
    if (!user.active && !bootstrapOwner) {
      throw new HttpError(403, "This BAIRD portal account is inactive.", "ACCOUNT_INACTIVE");
    }

    const now = new Date();
    user = await saveUser({
      ...user,
      name: user.name || payload.name || email,
      googleSub,
      role: bootstrapOwner ? "owner" : user.role,
      active: bootstrapOwner ? true : user.active,
      lastLoginAt: now.toISOString()
    });
    const token = await signSession({
      userId: user.id,
      googleSub,
      issuedAt: Math.floor(now.getTime() / 1000),
      expiresAt: Math.floor(now.getTime() / 1000) + SESSION_DURATION_SECONDS
    }, requiredEnv("SESSION_SECRET"));

    return Response.json({ redirectTo: "/", user: { name: user.name, email: user.email, role: user.role } }, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": sessionCookie(token, new URL(request.url).protocol === "https:")
      }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/auth/google",
  method: "POST"
};
