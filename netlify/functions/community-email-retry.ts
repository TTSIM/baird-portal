import type { Config } from "@netlify/functions";
import { sendCommunityEmail } from "./_shared/community-email.js";
import { listEmailJobs } from "./_shared/community-data.js";
import { env } from "./_shared/env.js";

export default async function handler() {
  const baseUrl = env("URL");
  const jobs = (await listEmailJobs())
    .filter(({ status, attempts }) => status !== "sent" && attempts < 5)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, 25);
  await Promise.all(jobs.map((job) => sendCommunityEmail(job, baseUrl)));
}

export const config: Config = {
  schedule: "@hourly"
};
