import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  cleanCategory,
  cleanRequiredText,
  decodeCursor,
  encodeCursor,
  imageSignatureMime,
  MAX_IMAGE_BYTES,
  nextReplyDepth,
  publicAuthor,
  requireCompleteProfile,
  requireSameOrigin,
  validateImageSize,
  validatePostImageCount
} from "../../netlify/functions/_shared/community.ts";
import { emailPreferenceAllows } from "../../netlify/functions/_shared/community-email.ts";
import { normalizeImage } from "../../netlify/functions/community-upload.ts";

const user = {
  id: "delegate-1",
  email: "private@example.com",
  name: "Test Delegate",
  location: "Leeds",
  role: "delegate",
  active: true,
  grants: [],
  completedCourseIds: ["implant-dentistry-2026"],
  notificationPreferences: {
    emailReplies: false,
    emailMentions: true,
    emailAcceptedAnswers: false
  },
  createdAt: "2026-07-23T10:00:00.000Z",
  updatedAt: "2026-07-23T10:00:00.000Z"
};

test("requires profile completion and exposes only community-safe profile fields", () => {
  assert.throws(() => requireCompleteProfile(user), { code: "PROFILE_REQUIRED", status: 428 });
  const complete = { ...user, profileCompletedAt: "2026-07-23T10:05:00.000Z" };
  assert.equal(requireCompleteProfile(complete), complete);
  const visible = publicAuthor(complete);
  assert.equal(visible.name, "Test Delegate");
  assert.equal(visible.location, "Leeds");
  assert.deepEqual(visible.completedCourseIds, ["implant-dentistry-2026"]);
  assert.equal("email" in visible, false);
});

test("validates post text, categories, image limits, and exact 10 MB acceptance", () => {
  assert.equal(cleanRequiredText("  A concise question  ", "Question", 5000), "A concise question");
  assert.equal(cleanCategory("case-support"), "case-support");
  assert.throws(() => cleanRequiredText("x".repeat(161), "Title", 160), { code: "CONTENT_TOO_LONG" });
  assert.throws(() => cleanCategory("clinical-advice"), { code: "INVALID_CATEGORY" });
  assert.equal(validateImageSize(MAX_IMAGE_BYTES), MAX_IMAGE_BYTES);
  assert.throws(() => validateImageSize(MAX_IMAGE_BYTES + 1), { code: "IMAGE_TOO_LARGE" });
  assert.doesNotThrow(() => validatePostImageCount([1, 2, 3, 4]));
  assert.throws(() => validatePostImageCount([1, 2, 3, 4, 5]), { code: "TOO_MANY_IMAGES" });
});

test("detects supported image signatures and rejects forged content", () => {
  assert.equal(imageSignatureMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageSignatureMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(imageSignatureMime(new TextEncoder().encode("RIFF....WEBP")), "image/webp");
  assert.equal(imageSignatureMime(new TextEncoder().encode("<script>alert(1)</script>")), null);
});

test("decodes, re-encodes, strips EXIF, and caps the longest image edge", async () => {
  const input = await sharp({
    create: { width: 5000, height: 12, channels: 3, background: "#c7d9eb" }
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "Patient Name" } })
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const output = await normalizeImage(input, "image/jpeg");
  const metadata = await sharp(output.normalized.data).metadata();
  assert.equal(metadata.width, 4096);
  assert.equal(metadata.exif, undefined);
  assert.equal((await sharp(output.thumbnail).metadata()).format, "webp");
});

test("limits reply nesting to three levels and round-trips feed cursors", () => {
  assert.equal(nextReplyDepth(), 1);
  assert.equal(nextReplyDepth(1), 2);
  assert.equal(nextReplyDepth(2), 3);
  assert.throws(() => nextReplyDepth(3), { code: "MAX_REPLY_DEPTH" });
  const cursor = { activityAt: "2026-07-23T12:00:00.000Z", id: "post-20" };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.throws(() => decodeCursor("not-a-cursor"), { code: "INVALID_CURSOR" });
});

test("requires verified same-origin community writes", () => {
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://portal.example/api/community/posts", {
    method: "POST",
    headers: { Origin: "https://portal.example", "Sec-Fetch-Site": "same-origin" }
  })));
  assert.throws(() => requireSameOrigin(new Request("https://portal.example/api/community/posts", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" }
  })), { code: "INVALID_ORIGIN", status: 403 });
});

test("honours profile email preferences while keeping moderation notices enabled", () => {
  assert.equal(emailPreferenceAllows(user, "reply"), false);
  assert.equal(emailPreferenceAllows(user, "mention"), true);
  assert.equal(emailPreferenceAllows(user, "accepted-answer"), false);
  assert.equal(emailPreferenceAllows(user, "moderation"), true);
});
