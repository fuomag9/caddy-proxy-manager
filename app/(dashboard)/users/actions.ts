"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import {
  updateUserProfile,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  type User,
} from "@/src/lib/models/user";
import { logAuditEvent } from "@/src/lib/audit";

export async function updateUserRoleAction(userId: number, role: User["role"]) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw new Error("Cannot change your own role");
  }

  await updateUserRole(userId, role);

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} role to ${role}`,
  });

  revalidatePath("/users");
}

export async function updateUserStatusAction(userId: number, status: string) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw new Error("Cannot change your own status");
  }

  await updateUserStatus(userId, status);

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Changed user ${userId} status to ${status}`,
  });

  revalidatePath("/users");
}

export async function updateUserInfoAction(userId: number, formData: FormData) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  const name = formData.get("name") ? String(formData.get("name")).trim() : undefined;
  const email = formData.get("email") ? String(formData.get("email")).trim() : undefined;

  await updateUserProfile(userId, { name, email });

  logAuditEvent({
    userId: actorId,
    action: "update",
    entityType: "user",
    entityId: userId,
    summary: `Updated user ${userId} profile`,
  });

  revalidatePath("/users");
}

export async function deleteUserAction(userId: number) {
  const session = await requireAdmin();
  const actorId = Number(session.user.id);

  if (actorId === userId) {
    throw new Error("Cannot delete your own account");
  }

  await deleteUser(userId);

  logAuditEvent({
    userId: actorId,
    action: "delete",
    entityType: "user",
    entityId: userId,
    summary: `Deleted user ${userId}`,
  });

  revalidatePath("/users");
}
