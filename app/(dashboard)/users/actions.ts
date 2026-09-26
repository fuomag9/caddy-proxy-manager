"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import {
  createUser,
  updateUserProfile,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  type User,
} from "@/src/lib/models/user";
import { logAuditEvent } from "@/src/lib/audit";
import { passwordPolicyMessage } from "@/src/lib/password-policy";

const VALID_ROLES = new Set<User["role"]>(["admin", "user", "viewer"]);
const VALID_STATUSES = new Set(["active", "disabled"]);

/**
 * Outcome of a user-management action. Problems the admin can fix come back
 * as `error` for the page to show inline; a thrown error would replace the
 * whole page with the error screen (and lose the form).
 */
export type UserActionResult = { ok: true } | { ok: false; error: string };

function failure(error: string): UserActionResult {
  return { ok: false, error };
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the driver error, so look through the cause chain.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Maps a storage error to a message for the admin. Anything unexpected is
 * logged and reported generically: driver messages can carry query text and
 * parameters.
 */
function storageFailure(error: unknown, action: string): UserActionResult {
  if (isUniqueViolation(error)) {
    return failure("A user with this email already exists");
  }
  console.error(`Failed to ${action}:`, error);
  return failure(`Failed to ${action}`);
}

export async function createUserAction(formData: FormData): Promise<UserActionResult> {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  const email = String(formData.get("email") ?? "").trim();
  const name = formData.get("name") ? String(formData.get("name")).trim() : null;
  const requestedRole = String(formData.get("role") ?? "user");
  const role = VALID_ROLES.has(requestedRole as User["role"]) ? (requestedRole as User["role"]) : "user";
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return failure("Email and password are required");
  }
  const policyError = passwordPolicyMessage(password);
  if (policyError) {
    return failure(policyError);
  }

  const bcrypt = await import("bcryptjs");
  const passwordHash = await bcrypt.default.hash(password, 12);

  let user: User;
  try {
    user = await createUser({
      email,
      name,
      role,
      provider: "credentials",
      subject: email,
      passwordHash,
    });
  } catch (error) {
    return storageFailure(error, "create user");
  }

  logAuditEvent({
    userId: actorId,
    action: "create",
    entityType: "user",
    entityId: user.id,
    summary: `Created user ${user.id} (${email}) with role ${role}`,
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function updateUserRoleAction(userId: number, role: User["role"]): Promise<UserActionResult> {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    return failure("Cannot change your own role");
  }
  // Server Action arguments come from the client; accept only known roles.
  if (!VALID_ROLES.has(role)) {
    return failure("Invalid role");
  }

  try {
    await updateUserRole(userId, role);
  } catch (error) {
    return storageFailure(error, "update user role");
  }

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} role to ${role}`,
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function updateUserStatusAction(userId: number, status: string): Promise<UserActionResult> {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    return failure("Cannot change your own status");
  }
  if (!VALID_STATUSES.has(status)) {
    return failure("Invalid status");
  }

  try {
    await updateUserStatus(userId, status);
  } catch (error) {
    return storageFailure(error, "update user status");
  }

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} status to ${status}`,
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function updateUserInfoAction(userId: number, formData: FormData): Promise<UserActionResult> {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  const name = formData.get("name") ? String(formData.get("name")).trim() : undefined;
  const email = formData.get("email") ? String(formData.get("email")).trim() : undefined;

  try {
    await updateUserProfile(userId, { name, email });
  } catch (error) {
    return storageFailure(error, "update user");
  }

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Updated user ${userId} profile`,
  });

  revalidatePath("/users");
  return { ok: true };
}

export async function deleteUserAction(userId: number): Promise<UserActionResult> {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    return failure("Cannot delete your own account");
  }

  try {
    await deleteUser(userId);
  } catch (error) {
    return storageFailure(error, "delete user");
  }

  logAuditEvent({
    userId: actorId,
    action: "delete",
    entityType: "user",
    entityId: userId,
    summary: `Deleted user ${userId}`,
  });

  revalidatePath("/users");
  return { ok: true };
}
