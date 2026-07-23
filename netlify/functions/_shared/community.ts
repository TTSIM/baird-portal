import { Buffer } from "node:buffer";
import { env } from "./env.js";
import { HttpError } from "./auth.js";
import type { UserRecord, UserRole } from "./models.js";

export const COMMUNITY_PAGE_SIZE = 20;
export const MAX_POST_TITLE = 160;
export const MAX_POST_BODY = 5_000;
export const MAX_REPLY_BODY = 3_000;
export const MAX_REPLY_DEPTH = 3;
export const MAX_POST_IMAGES = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1_000;
export const DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export const COMMUNITY_CATEGORIES = ["general", "case-support", "course-question"] as const;
export type CommunityCategory = typeof COMMUNITY_CATEGORIES[number];

export const REACTION_KINDS = ["helpful", "thanks", "insightful"] as const;
export type ReactionKind = typeof REACTION_KINDS[number];

export const REPORT_REASONS = [
  "patient-confidentiality",
  "unsafe-advice",
  "inappropriate",
  "spam",
  "other"
] as const;
export type ReportReason = typeof REPORT_REASONS[number];

export type CommunityContentStatus = "active" | "hidden" | "deleted";
export type CommunityTargetType = "post" | "reply";

export type CommunityAuthorSnapshot = {
  id: string;
  name: string;
  location?: string;
  role: UserRole;
  avatarUrl?: string;
  completedCourseIds: string[];
};

export type CommunityAttachmentRecord = {
  id: string;
  ownerId: string;
  purpose: "avatar" | "post";
  originalFilename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: number;
  width: number;
  height: number;
  imageKey: string;
  thumbnailKey: string;
  altText?: string;
  attachedTo?: { type: "avatar" | "post"; id: string };
  createdAt: string;
  deletedAt?: string;
};

export type CommunityUploadRecord = {
  id: string;
  ownerId: string;
  purpose: "avatar" | "post";
  originalFilename: string;
  declaredMimeType: string;
  declaredBytes: number;
  expectedChunks: number;
  receivedChunks: number[];
  createdAt: string;
  expiresAt: string;
};

export type CommunityPostRecord = {
  id: string;
  authorId: string;
  title: string;
  body: string;
  category: CommunityCategory;
  courseId?: string;
  attachmentIds: string[];
  caseAttestationAt?: string;
  acceptedReplyId?: string;
  resolvedAt?: string;
  lockedAt?: string;
  status: CommunityContentStatus;
  createdAt: string;
  updatedAt: string;
  activityAt: string;
  editedAt?: string;
  deletedAt?: string;
  hiddenAt?: string;
};

export type CommunityReplyRecord = {
  id: string;
  postId: string;
  parentReplyId?: string;
  depth: number;
  authorId: string;
  body: string;
  status: CommunityContentStatus;
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
  deletedAt?: string;
  hiddenAt?: string;
};

export type CommunityReactionRecord = {
  targetType: CommunityTargetType;
  targetId: string;
  postId: string;
  userId: string;
  reaction: ReactionKind;
  createdAt: string;
};

export type CommunityReportRecord = {
  id: string;
  targetType: CommunityTargetType;
  targetId: string;
  postId: string;
  reporterId: string;
  reason: ReportReason;
  details?: string;
  status: "open" | "reviewed";
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
};

export type CommunityNotificationKind =
  | "reply"
  | "mention"
  | "reaction"
  | "accepted-answer"
  | "moderation";

export type CommunityNotificationRecord = {
  id: string;
  userId: string;
  actorId?: string;
  kind: CommunityNotificationKind;
  postId?: string;
  targetId?: string;
  createdAt: string;
  readAt?: string;
};

export type CommunityModerationRecord = {
  id: string;
  actorId: string;
  action: "hide" | "restore" | "lock" | "unlock" | "delete" | "remove-image";
  targetType: CommunityTargetType | "attachment";
  targetId: string;
  reason?: string;
  createdAt: string;
};

export type CommunityEmailJob = {
  id: string;
  userId: string;
  to: string;
  kind: "reply" | "mention" | "accepted-answer" | "moderation";
  postId?: string;
  attempts: number;
  status: "queued" | "sent" | "failed";
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

export function communityEnabled(): boolean {
  return env("COMMUNITY_ENABLED") === "true";
}

export function requireCommunityEnabled(): void {
  if (!communityEnabled()) {
    throw new HttpError(404, "Community is not enabled.", "COMMUNITY_DISABLED");
  }
}

export function requireCompleteProfile(user: UserRecord): UserRecord {
  if (!user.profileCompletedAt) {
    throw new HttpError(428, "Complete your profile to use the community.", "PROFILE_REQUIRED");
  }
  return user;
}

export function requireSameOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new HttpError(403, "The request origin is not allowed.", "INVALID_ORIGIN");
  }
  const supplied = origin || (referer ? new URL(referer).origin : "");
  if (!supplied || supplied !== requestUrl.origin) {
    throw new HttpError(403, "The request origin could not be verified.", "INVALID_ORIGIN");
  }
}

export function cleanRequiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${label} is required.`, "INVALID_CONTENT");
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (!clean) throw new HttpError(400, `${label} is required.`, "INVALID_CONTENT");
  if (clean.length > maxLength) {
    throw new HttpError(400, `${label} cannot exceed ${maxLength.toLocaleString()} characters.`, "CONTENT_TOO_LONG");
  }
  return clean;
}

export function cleanOptionalText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.replace(/\r\n?/g, "\n").trim();
  if (!clean) return undefined;
  if (clean.length > maxLength) {
    throw new HttpError(400, `Text cannot exceed ${maxLength.toLocaleString()} characters.`, "CONTENT_TOO_LONG");
  }
  return clean;
}

export function cleanCategory(value: unknown): CommunityCategory {
  if (typeof value !== "string" || !COMMUNITY_CATEGORIES.includes(value as CommunityCategory)) {
    throw new HttpError(400, "Choose a valid discussion category.", "INVALID_CATEGORY");
  }
  return value as CommunityCategory;
}

export function cleanReaction(value: unknown): ReactionKind {
  if (typeof value !== "string" || !REACTION_KINDS.includes(value as ReactionKind)) {
    throw new HttpError(400, "Choose a valid reaction.", "INVALID_REACTION");
  }
  return value as ReactionKind;
}

export function cleanReportReason(value: unknown): ReportReason {
  if (typeof value !== "string" || !REPORT_REASONS.includes(value as ReportReason)) {
    throw new HttpError(400, "Choose a valid report reason.", "INVALID_REPORT_REASON");
  }
  return value as ReportReason;
}

export function cleanImageMimeType(value: unknown): CommunityAttachmentRecord["mimeType"] {
  if (value !== "image/jpeg" && value !== "image/png" && value !== "image/webp") {
    throw new HttpError(400, "Upload a JPEG, PNG or WebP image.", "INVALID_IMAGE_TYPE");
  }
  return value;
}

export function validateImageSize(value: unknown): number {
  const bytes = Number(value);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    throw new HttpError(400, "Images must be 10 MB or smaller.", "IMAGE_TOO_LARGE");
  }
  return bytes;
}

export function validatePostImageCount(value: unknown[]): void {
  if (value.length > MAX_POST_IMAGES) {
    throw new HttpError(400, `Attach no more than ${MAX_POST_IMAGES} images.`, "TOO_MANY_IMAGES");
  }
}

export function nextReplyDepth(parentDepth?: number): number {
  const depth = parentDepth === undefined ? 1 : parentDepth + 1;
  if (depth > MAX_REPLY_DEPTH) {
    throw new HttpError(400, `Replies can be nested up to ${MAX_REPLY_DEPTH} levels.`, "MAX_REPLY_DEPTH");
  }
  return depth;
}

export function cleanFilename(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "A filename is required.", "INVALID_FILENAME");
  const clean = value.replace(/[^\p{L}\p{N}._ -]+/gu, "").trim().slice(0, 160);
  if (!clean) throw new HttpError(400, "A valid filename is required.", "INVALID_FILENAME");
  return clean;
}

export function publicAuthor(user: UserRecord): CommunityAuthorSnapshot {
  const avatarUrl = user.avatar?.kind === "upload" && user.avatar.assetId
    ? `/api/community/images/${encodeURIComponent(user.avatar.assetId)}?variant=thumbnail`
    : user.avatar?.kind === "google"
      ? user.avatar.url || user.googlePictureUrl
      : undefined;
  return {
    id: user.id,
    name: user.name,
    location: user.location,
    role: user.role,
    avatarUrl,
    completedCourseIds: user.completedCourseIds || []
  };
}

export function encodeCursor(value: { activityAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(value: string | null): { activityAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof parsed.activityAt === "string" && typeof parsed.id === "string"
      ? { activityAt: parsed.activityAt, id: parsed.id }
      : null;
  } catch {
    throw new HttpError(400, "The pagination cursor is invalid.", "INVALID_CURSOR");
  }
}

export function imageSignatureMime(bytes: Uint8Array): CommunityAttachmentRecord["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
