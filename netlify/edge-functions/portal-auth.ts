import type { Config, Context } from "@netlify/edge-functions";
import { authenticatedUser } from "../functions/_shared/auth.js";
import { resolveMaterialAccess, userCanAccessModule } from "../functions/_shared/course-catalog.js";
import { isStaffRole } from "../functions/_shared/roles.js";

function loginRedirect(request: Request) {
  const url = new URL("/", request.url);
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
    || path === "/admin.html";
  const material = path.startsWith("/materials/");
  if (!protectedPage && !material) return;

  const user = await authenticatedUser(request);
  if (!user) return loginRedirect(request);

  if (path === "/admin.html" && !isStaffRole(user.role)) {
    return denied("Administrator access is required.", 403);
  }

  if (material) {
    const access = resolveMaterialAccess(path);
    if (!access) return denied("This course resource is not registered.", 404);
    if (!userCanAccessModule(user, access.moduleId)) {
      return denied("This module has not been unlocked for your account.", 403);
    }
  }
}

export const config: Config = {
  path: "/*",
  onError: "fail"
};
