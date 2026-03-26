"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/src/lib/auth";
import { createApiToken, deleteApiToken } from "@/src/lib/models/api-tokens";

export async function createApiTokenAction(formData: FormData): Promise<{ rawToken: string } | { error: string }> {
  const session = await requireUser();
  const userId = Number(session.user.id);
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Name is required" };
  }

  const expiresAt = formData.get("expires_at") ? String(formData.get("expires_at")) : undefined;

  const { rawToken } = await createApiToken(name, userId, expiresAt || undefined);
  revalidatePath("/profile");
  return { rawToken };
}

export async function deleteApiTokenAction(id: number) {
  const session = await requireUser();
  const userId = Number(session.user.id);
  await deleteApiToken(id, userId);
  revalidatePath("/profile");
}
