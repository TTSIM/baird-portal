import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPortalView,
  courseIdsForGrants,
  resolveMaterialAccess,
  userCanAccessModule
} from "../../netlify/functions/_shared/course-catalog.ts";
import { signSession, verifySession } from "../../netlify/functions/_shared/session.ts";
import { buildFileSearchFilter } from "../../netlify/functions/ask-dr-hassan.ts";
import { bootstrapOwnerEmails } from "../../netlify/functions/_shared/env.ts";
import {
  bootstrappedRole,
  canAssignRole,
  canManageUser,
  removesActiveOwner
} from "../../netlify/functions/_shared/roles.ts";

const delegate = {
  id: "user-1",
  email: "delegate@example.com",
  name: "Delegate",
  role: "delegate",
  active: true,
  grants: ["implant-module-1"],
  googleSub: "google-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z"
};

test("signs, verifies, expires, and rejects tampered sessions", async () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  const claims = { userId: "user-1", googleSub: "google-1", issuedAt: 100, expiresAt: 200 };
  const token = await signSession(claims, secret);
  assert.deepEqual(await verifySession(token, secret, 150_000), claims);
  assert.equal(await verifySession(token, secret, 201_000), null);
  assert.equal(await verifySession(`${token.slice(0, -1)}x`, secret, 150_000), null);
});

test("keeps locked module details out of the delegate portal view", () => {
  const view = buildPortalView(delegate);
  const unlocked = view.modules.find(({ id }) => id === "implant-module-1");
  const locked = view.modules.find(({ id }) => id === "implant-module-2");
  assert.equal(unlocked.locked, false);
  assert.equal(locked.locked, true);
  assert.equal("topics" in locked, false);
  assert.equal("days" in locked, false);
});

test("maps protected materials to modules and honours staff access", () => {
  const access = resolveMaterialAccess("/materials/lectures/lecture_1_foundations_history_bone_biology.html");
  assert.deepEqual(access, { courseId: "implant-dentistry-2026", moduleId: "implant-module-1" });
  assert.equal(userCanAccessModule(delegate, "implant-module-1"), true);
  assert.equal(userCanAccessModule(delegate, "implant-module-2"), false);
  assert.equal(userCanAccessModule({ ...delegate, role: "admin", grants: [] }, "implant-module-2"), true);
  assert.equal(userCanAccessModule({ ...delegate, role: "owner", grants: [] }, "implant-module-2"), true);
});

test("gives owner bootstrap precedence and enforces role-management boundaries", () => {
  const email = "simsingh@gmail.com";
  assert.equal(bootstrapOwnerEmails().has(email), true);
  assert.equal(bootstrappedRole(email, new Set([email]), new Set([email])), "owner");
  assert.equal(bootstrappedRole("admin@example.com", new Set(), new Set(["admin@example.com"])), "admin");
  assert.equal(canAssignRole("admin", "delegate"), true);
  assert.equal(canAssignRole("admin", "admin"), false);
  assert.equal(canManageUser("admin", "delegate"), true);
  assert.equal(canManageUser("admin", "owner"), false);
  assert.equal(canAssignRole("owner", "owner"), true);
  assert.equal(canManageUser("owner", "admin"), true);
  assert.equal(removesActiveOwner("owner", true, "admin", true), true);
  assert.equal(removesActiveOwner("owner", true, "owner", false), true);
  assert.equal(removesActiveOwner("owner", true, "owner", true), false);
});

test("builds a combined module and private-course file-search filter", () => {
  const modules = ["implant-module-1"];
  const courses = courseIdsForGrants(modules);
  const filter = buildFileSearchFilter(modules, courses);
  assert.equal(filter.type, "or");
  assert.deepEqual(filter.filters[0].filters[1], { type: "in", key: "module_id", value: modules });
  assert.deepEqual(filter.filters[1].filters[1], { type: "in", key: "course_id", value: ["implant-dentistry-2026"] });
  assert.deepEqual(filter.filters[1].filters[2], { type: "eq", key: "source_visibility", value: "private_ai_only" });
});
