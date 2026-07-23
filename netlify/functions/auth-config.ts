import { randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { env } from "./_shared/env.js";
import { csrfCookie } from "./_shared/session.js";

export default async function handler(request: Request) {
  if (request.method !== "GET") {
    return Response.json({ error: "Only GET is accepted." }, { status: 405, headers: { Allow: "GET" } });
  }

  const googleClientId = env("GOOGLE_CLIENT_ID");
  if (!googleClientId) {
    return Response.json({ error: "Google sign-in has not been configured.", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  const csrfToken = randomBytes(32).toString("base64url");
  return Response.json({ googleClientId, csrfToken }, {
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": csrfCookie(csrfToken, new URL(request.url).protocol === "https:")
    }
  });
}

export const config: Config = {
  path: "/api/auth/config",
  method: "GET"
};
