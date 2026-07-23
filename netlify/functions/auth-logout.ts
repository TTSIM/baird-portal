import type { Config } from "@netlify/functions";
import { clearSessionCookie } from "./_shared/session.js";

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Only POST is accepted." }, { status: 405, headers: { Allow: "POST" } });
  }

  return Response.json({ ok: true }, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": clearSessionCookie(new URL(request.url).protocol === "https:")
    }
  });
}

export const config: Config = {
  path: "/api/auth/logout",
  method: "POST"
};
