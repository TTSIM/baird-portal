import type { Config } from "@netlify/functions";
import { activeOwnerCount, createUser, getUserById, listUsers, saveUser } from "./_shared/data.js";
import { HttpError, jsonError, requireStaff } from "./_shared/auth.js";
import {
  normalizeCompletedCourses,
  normalizeGrants,
  publicCourseOptions,
  courseCatalog
} from "./_shared/course-catalog.js";
import type { UserRole } from "./_shared/models.js";
import { canAssignRole, canManageUser, removesActiveOwner } from "./_shared/roles.js";

function adminUserView(user: Awaited<ReturnType<typeof createUser>>) {
  const { googleSub, ...safe } = user;
  return { ...safe, googleLinked: Boolean(googleSub) };
}

function cleanRole(value: unknown): UserRole {
  if (value !== "owner" && value !== "admin" && value !== "delegate") {
    throw new HttpError(400, "Choose a valid role.", "INVALID_ROLE");
  }
  return value;
}

function cleanEmail(value: unknown) {
  if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new HttpError(400, "Enter a valid email address.", "INVALID_EMAIL");
  }
  return value.trim().toLowerCase();
}

export default async function handler(request: Request) {
  try {
    const admin = await requireStaff(request);

    if (request.method === "GET") {
      return Response.json({
        users: (await listUsers()).map(adminUserView),
        permissions: { canAssignPrivilegedRoles: admin.role === "owner" },
        courses: publicCourseOptions().map((course) => ({
          ...course,
          modules: courseCatalog.modules
            .filter((module) => module.courseId === course.id)
            .map(({ id, title, typeLabel }) => ({ id, title, typeLabel }))
        }))
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (request.method === "POST") {
      const body = await request.json() as Record<string, unknown>;
      const role = cleanRole(body.role ?? "delegate");
      if (!canAssignRole(admin.role, role)) {
        throw new HttpError(403, "Only an owner can create administrators or owners.", "OWNER_REQUIRED");
      }
      let user = await createUser({
        email: cleanEmail(body.email),
        name: typeof body.name === "string" ? body.name.trim() : "",
        role,
        grants: normalizeGrants(body.grants),
        active: body.active !== false
      });
      if (body.completedCourseIds !== undefined) {
        user = await saveUser({ ...user, completedCourseIds: normalizeCompletedCourses(body.completedCourseIds) });
      }
      return Response.json({ user: adminUserView(user) }, { status: 201 });
    }

    if (request.method === "PATCH") {
      const body = await request.json() as Record<string, unknown>;
      if (typeof body.id !== "string") throw new HttpError(400, "A user ID is required.", "MISSING_USER");
      const current = await getUserById(body.id);
      if (!current) throw new HttpError(404, "User not found.", "USER_NOT_FOUND");
      const nextRole = body.role === undefined ? current.role : cleanRole(body.role);
      const nextActive = body.active === undefined ? current.active : Boolean(body.active);
      if (!canManageUser(admin.role, current.role) || !canAssignRole(admin.role, nextRole)) {
        throw new HttpError(403, "Only an owner can manage administrators or owners.", "OWNER_REQUIRED");
      }
      if (removesActiveOwner(current.role, current.active, nextRole, nextActive) && await activeOwnerCount() <= 1) {
        throw new HttpError(409, "The final active owner cannot be removed.", "LAST_OWNER");
      }

      const user = await saveUser({
        ...current,
        name: typeof body.name === "string" ? body.name.trim() || current.name : current.name,
        role: nextRole,
        active: nextActive,
        grants: body.grants === undefined ? current.grants : normalizeGrants(body.grants),
        completedCourseIds: body.completedCourseIds === undefined
          ? current.completedCourseIds || []
          : normalizeCompletedCourses(body.completedCourseIds)
      });
      return Response.json({ user: adminUserView(user), updatedBy: admin.id });
    }

    return Response.json({ error: "Method not allowed." }, {
      status: 405,
      headers: { Allow: "GET, POST, PATCH" }
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const config: Config = {
  path: "/api/admin/users",
  method: ["GET", "POST", "PATCH"]
};
