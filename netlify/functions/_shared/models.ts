export type UserRole = "owner" | "admin" | "delegate";

export type NotificationPreferences = {
  emailReplies: boolean;
  emailMentions: boolean;
  emailAcceptedAnswers: boolean;
};

export type CommunityAvatar = {
  kind: "google" | "upload";
  url?: string;
  assetId?: string;
};

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  location?: string;
  avatar?: CommunityAvatar;
  googlePictureUrl?: string;
  profileCompletedAt?: string;
  completedCourseIds: string[];
  notificationPreferences: NotificationPreferences;
  googleSub?: string;
  role: UserRole;
  active: boolean;
  grants: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type SessionClaims = {
  userId: string;
  googleSub: string;
  issuedAt: number;
  expiresAt: number;
};

export type KnowledgeStatus = "queued" | "indexing" | "ready" | "failed" | "deleting";

export type KnowledgeSourceRecord = {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  bytes: number;
  courseId: string;
  status: KnowledgeStatus;
  blobKey: string;
  openaiFileId?: string;
  uploadedBy: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
  error?: string;
  failureOperation?: "index" | "delete";
};

export type UsageStatus = "success" | "unsupported" | "provider_error" | "rate_limited";

export type AskUsageRecord = {
  id: string;
  createdAt: string;
  user: { id: string; name: string; email: string; role: UserRole };
  question: string;
  status: UsageStatus;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  matchedCourseIds: string[];
  matchedModuleIds: string[];
  citations: Array<{ label: string; href?: string; type: string }>;
};
