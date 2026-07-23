import type { UserRole } from "./models.js";

export function isStaffRole(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export function hasFullCourseAccess(role: UserRole): boolean {
  return isStaffRole(role);
}

export function canAssignRole(actorRole: UserRole, role: UserRole): boolean {
  return actorRole === "owner" || role === "delegate";
}

export function canManageUser(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === "owner" || targetRole === "delegate";
}

export function bootstrappedRole(email: string, owners: Set<string>, admins: Set<string>): UserRole | null {
  if (owners.has(email)) return "owner";
  if (admins.has(email)) return "admin";
  return null;
}

export function removesActiveOwner(
  currentRole: UserRole,
  currentActive: boolean,
  nextRole: UserRole,
  nextActive: boolean
): boolean {
  return currentRole === "owner" && currentActive && (nextRole !== "owner" || !nextActive);
}
