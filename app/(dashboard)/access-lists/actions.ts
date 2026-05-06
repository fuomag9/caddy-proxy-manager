"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import {
  addAccessListEntry,
  createAccessList,
  deleteAccessList,
  removeAccessListEntry,
  updateAccessList
} from "@/src/lib/models/access-lists";

export async function createAccessListAction(input: {
  name: string;
  description: string | null;
  users: { username: string; password: string }[];
}) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const list = await createAccessList(
    {
      name: input.name,
      description: input.description,
      users: input.users.filter((u) => u.username.trim() && u.password),
    },
    userId
  );
  revalidatePath("/access-lists");
  return list;
}

export async function updateAccessListAction(
  id: number,
  input: { name?: string; description?: string | null }
) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const list = await updateAccessList(id, input, userId);
  revalidatePath("/access-lists");
  return list;
}

export async function deleteAccessListAction(id: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await deleteAccessList(id, userId);
  revalidatePath("/access-lists");
}

export async function addAccessEntryAction(
  accessListId: number,
  entry: { username: string; password: string }
) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const list = await addAccessListEntry(accessListId, entry, userId);
  revalidatePath("/access-lists");
  return list;
}

export async function deleteAccessEntryAction(
  accessListId: number,
  entryId: number
) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const list = await removeAccessListEntry(accessListId, entryId, userId);
  revalidatePath("/access-lists");
  return list;
}

export async function bulkDeleteEntriesAction(
  accessListId: number,
  entryIds: number[]
) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  let list;
  for (const entryId of entryIds) {
    list = await removeAccessListEntry(accessListId, entryId, userId);
  }
  revalidatePath("/access-lists");
  return list;
}

export async function regeneratePasswordAction(
  accessListId: number,
  entryId: number,
  newPassword: string
) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  // Remove old entry and add new one with same username
  // We need to get the username first
  const { removeAccessListEntry: remove, addAccessListEntry: add, getAccessList } = await import(
    "@/src/lib/models/access-lists"
  );
  const listBefore = await getAccessList(accessListId);
  if (!listBefore) throw new Error("Access list not found");
  const entry = listBefore.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error("Entry not found");

  await remove(accessListId, entryId, userId);
  const list = await add(accessListId, { username: entry.username, password: newPassword }, userId);
  revalidatePath("/access-lists");
  return list;
}
