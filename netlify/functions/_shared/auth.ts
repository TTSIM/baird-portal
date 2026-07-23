import type { UserRecord } from "./models.js";
import { env } from "./env.js";
import { getUserById } from "./data.js";
import { isStaffRole } from "./roles.js";
import { cookieValue, SESSION_COOKIE, verifySession } from "./session.js";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") {
    super(message);
  }
}

export async function authenticatedUser(request: Request): Promise<UserRecord | null> {
  const secret = env("SESSION_SECRET");
  if (!secret) return null;
  const claims = await verifySession(cookieValue(request, SESSION_COOKIE), secret);
  if (!claims) return null;
  const user = await getUserById(claims.userId);
  if (!user?.active || user.googleSub !== claims.googleSub) return null;
  return user;
}

export async function requireUser(request: Request): Promise<UserRecord> {
  const user = await authenticatedUser(request);
  if (!user) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  return user;
}

export async function requireStaff(request: Request): Promise<UserRecord> {
  const user = await requireUser(request);
  if (!isStaffRole(user.role)) throw new HttpError(403, "Administrator access is required.", "FORBIDDEN");
  return user;
}

export function jsonError(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  if (status >= 500) console.error(error);
  return Response.json({ error: message, code }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
