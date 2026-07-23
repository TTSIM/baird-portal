import type { Config } from "@netlify/functions";
import { HttpError, jsonError, requireStaff } from "./_shared/auth.js";
import { deleteUsage, listUsage } from "./_shared/data.js";

const RANGE_DAYS: Record<string, number | null> = {
  "7": 7,
  "30": 30,
  "90": 90,
  all: null
};

export default async function handler(request: Request) {
  try {
    await requireStaff(request);
    const url = new URL(request.url);

    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) throw new HttpError(400, "A usage record ID is required.", "MISSING_ID");
      if (!await deleteUsage(id)) throw new HttpError(404, "Usage record not found.", "NOT_FOUND");
      return new Response(null, { status: 204 });
    }

    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed." }, {
        status: 405,
        headers: { Allow: "GET, DELETE" }
      });
    }

    const range = url.searchParams.get("range") || "30";
    if (!(range in RANGE_DAYS)) throw new HttpError(400, "Choose a valid date range.", "INVALID_RANGE");
    const days = RANGE_DAYS[range];
    const threshold = days ? Date.now() - days * 86_400_000 : 0;
    const user = (url.searchParams.get("user") || "").trim().toLowerCase();
    const status = (url.searchParams.get("status") || "").trim();
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();

    const ranged = (await listUsage())
      .filter((record) => !threshold || Date.parse(record.createdAt) >= threshold)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const metrics = {
      totalQuestions: ranged.length,
      successfulAnswers: ranged.filter(({ status }) => status === "success").length,
      activeDelegates: new Set(ranged.filter(({ user }) => user.role === "delegate").map(({ user }) => user.id)).size,
      errors: ranged.filter(({ status }) => status === "provider_error").length,
      inputTokens: ranged.reduce((total, record) => total + record.usage.inputTokens, 0),
      outputTokens: ranged.reduce((total, record) => total + record.usage.outputTokens, 0)
    };

    const filtered = ranged.filter((record) => {
      const userMatch = !user || record.user.email.toLowerCase().includes(user) || record.user.name.toLowerCase().includes(user);
      const statusMatch = !status || record.status === status;
      const queryMatch = !query || record.question.toLowerCase().includes(query);
      return userMatch && statusMatch && queryMatch;
    });
    const pageSize = 50;
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));

    return Response.json({
      metrics,
      records: filtered.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, pageCount, total: filtered.length }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/admin/usage",
  method: ["GET", "DELETE"]
};
