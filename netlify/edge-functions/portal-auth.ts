import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/edge-functions";
import rawCatalog from "../../data/course-catalog.json" with { type: "json" };

type UserRole = "owner" | "admin" | "delegate";

type UserRecord = {
  id: string;
  googleSub?: string;
  profileCompletedAt?: string;
  role: UserRole;
  active: boolean;
  grants: string[];
};

type SessionClaims = {
  userId: string;
  googleSub: string;
  expiresAt: number;
};

const SESSION_COOKIE = "baird_session";
const USERS_STORE = "baird-users";

type MaterialAccess = { courseId: string; moduleId: string };
const materialAccess = new Map<string, MaterialAccess>();
const materialPrefixes: Array<{ prefix: string; access: MaterialAccess }> = [];

for (const module of rawCatalog.modules) {
  for (const file of module.knowledgeFiles || []) {
    materialAccess.set(`/${file.replace(/^\/+/, "")}`, {
      courseId: module.courseId,
      moduleId: module.id
    });
  }

  for (const day of module.days || []) {
    for (const lecture of day.lectures || []) {
      for (const resource of lecture.materials || []) {
        const access = { courseId: module.courseId, moduleId: module.id };
        materialAccess.set(`/${resource.file.replace(/^\/+/, "")}`, access);
        for (const prefix of resource.protectedPrefixes || []) {
          materialPrefixes.push({ prefix: `/${prefix.replace(/^\/+/, "")}`, access });
        }
      }
    }
  }
}

function env(name: string): string | undefined {
  return globalThis.Netlify?.env.get(name);
}

function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function verifySession(token: string | undefined, secret: string): Promise<SessionClaims | null> {
  if (!token || secret.length < 32) return null;
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(payload)
    );
    if (!valid) return null;

    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as SessionClaims;
    if (!claims.userId
      || !claims.googleSub
      || !Number.isFinite(claims.expiresAt)
      || claims.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

async function authenticatedUser(request: Request): Promise<UserRecord | null> {
  const secret = env("SESSION_SECRET");
  if (!secret) return null;
  const claims = await verifySession(cookieValue(request, SESSION_COOKIE), secret);
  if (!claims) return null;

  const user = await getStore({ name: USERS_STORE, consistency: "strong" })
    .get(`records/${claims.userId}`, { type: "json" }) as UserRecord | null;
  if (!user?.active || user.googleSub !== claims.googleSub) return null;
  return user;
}

function isStaffRole(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

function resolveMaterialAccess(pathname: string): MaterialAccess | null {
  const clean = decodeURIComponent(pathname).replace(/\/+/g, "/");
  return materialAccess.get(clean)
    || materialPrefixes.find(({ prefix }) => clean.startsWith(prefix))?.access
    || null;
}

function loginRedirect(request: Request) {
  const url = new URL("/", request.url);
  const current = new URL(request.url);
  url.searchParams.set("next", `${current.pathname}${current.search}`);
  return Response.redirect(url, 302);
}

function profileRedirect(request: Request) {
  const url = new URL("/profile-setup.html", request.url);
  const current = new URL(request.url);
  url.searchParams.set("next", `${current.pathname}${current.search}`);
  return Response.redirect(url, 302);
}

function denied(message: string, status: number) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>BAIRD Portal</title><body style="font:16px system-ui;padding:40px"><h1>Access unavailable</h1><p>${message}</p><p><a href="/">Return to the portal</a></p></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default async function portalAuth(request: Request, _context: Context) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/api/")
    || path === "/"
    || path === "/index.html"
    || path === "/login.html"
    || path.startsWith("/assets/")) return;

  const protectedPage = path === "/baird_implant_portal.html"
    || path === "/ask-dr-hassan.html"
    || path === "/admin.html"
    || path === "/profile-setup.html";
  const material = path.startsWith("/materials/");
  if (!protectedPage && !material) return;

  const user = await authenticatedUser(request);
  if (!user) return loginRedirect(request);
  if (!user.profileCompletedAt && path !== "/profile-setup.html") return profileRedirect(request);

  if (path === "/admin.html" && !isStaffRole(user.role)) {
    return denied("Administrator access is required.", 403);
  }

  if (material) {
    const access = resolveMaterialAccess(path);
    if (!access) return denied("This course resource is not registered.", 404);
    if (!isStaffRole(user.role) && !user.grants.includes(access.moduleId)) {
      return denied("This module has not been unlocked for your account.", 403);
    }
  }
}

export const config: Config = {
  path: "/*",
  onError: "fail"
};
