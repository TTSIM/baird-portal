import { newId, saveEmailJob } from "./community-data.js";
import type { CommunityEmailJob } from "./community.js";
import { env } from "./env.js";
import type { UserRecord } from "./models.js";

export function emailPreferenceAllows(
  user: UserRecord,
  kind: CommunityEmailJob["kind"]
): boolean {
  if (kind === "moderation") return true;
  if (kind === "reply") return user.notificationPreferences?.emailReplies !== false;
  if (kind === "mention") return user.notificationPreferences?.emailMentions !== false;
  return user.notificationPreferences?.emailAcceptedAnswers !== false;
}
export async function queueCommunityEmail(
  user: UserRecord,
  kind: CommunityEmailJob["kind"],
  postId?: string
): Promise<CommunityEmailJob | null> {
  if (!emailPreferenceAllows(user, kind)) return null;
  const now = new Date().toISOString();
  const job: CommunityEmailJob = {
    id: newId(),
    userId: user.id,
    to: user.email,
    kind,
    postId,
    attempts: 0,
    status: "queued",
    createdAt: now,
    updatedAt: now
  };
  await saveEmailJob(job);
  return job;
}

function emailMessage(kind: CommunityEmailJob["kind"]): string {
  if (kind === "reply") return "Someone replied to a BAIRD Community discussion you follow.";
  if (kind === "mention") return "Someone mentioned you in BAIRD Community.";
  if (kind === "accepted-answer") return "Your reply was accepted as the answer in BAIRD Community.";
  return "A BAIRD administrator updated community content connected to your account.";
}

export async function sendCommunityEmail(job: CommunityEmailJob, baseUrl?: string): Promise<CommunityEmailJob> {
  const now = new Date().toISOString();
  const secret = env("NETLIFY_EMAILS_SECRET");
  const sender = env("COMMUNITY_EMAIL_FROM");
  const siteUrl = baseUrl || env("URL");
  if (!secret || !sender || !siteUrl) {
    const failed = {
      ...job,
      attempts: job.attempts + 1,
      status: "failed" as const,
      updatedAt: now,
      lastError: "Community email is not configured."
    };
    await saveEmailJob(failed);
    return failed;
  }

  try {
    const link = new URL("/baird_implant_portal.html", siteUrl);
    link.searchParams.set("tab", "community");
    if (job.postId) link.searchParams.set("thread", job.postId);
    const response = await fetch(new URL("/.netlify/functions/emails/community-activity", siteUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "netlify-emails-secret": secret
      },
      body: JSON.stringify({
        from: sender,
        to: job.to,
        subject: "BAIRD Community activity",
        parameters: {
          message: emailMessage(job.kind),
          link: link.toString()
        }
      })
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    const sent = { ...job, attempts: job.attempts + 1, status: "sent" as const, updatedAt: now, lastError: undefined };
    await saveEmailJob(sent);
    return sent;
  } catch (error) {
    const failed = {
      ...job,
      attempts: job.attempts + 1,
      status: "failed" as const,
      updatedAt: now,
      lastError: error instanceof Error ? error.message.slice(0, 300) : "Email delivery failed."
    };
    await saveEmailJob(failed);
    return failed;
  }
}
