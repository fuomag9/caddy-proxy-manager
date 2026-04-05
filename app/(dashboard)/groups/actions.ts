"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import {
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember
} from "@/src/lib/models/groups";

export async function createGroupAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);

  await createGroup(
    {
      name: String(formData.get("name") ?? ""),
      description: formData.get("description") ? String(formData.get("description")) : null,
    },
    userId
  );

  revalidatePath("/groups");
}

export async function updateGroupAction(id: number, formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);

  await updateGroup(
    id,
    {
      name: String(formData.get("name") ?? ""),
      description: formData.get("description") ? String(formData.get("description")) : null,
    },
    userId
  );

  revalidatePath("/groups");
}

export async function deleteGroupAction(id: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await deleteGroup(id, userId);
  revalidatePath("/groups");
}

export async function addGroupMemberAction(groupId: number, memberId: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await addGroupMember(groupId, memberId, userId);
  revalidatePath("/groups");
}

export async function removeGroupMemberAction(groupId: number, memberId: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await removeGroupMember(groupId, memberId, userId);
  revalidatePath("/groups");
}
