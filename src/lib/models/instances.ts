import db, { nowIso, toIso } from "../db";
import { instances } from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { encryptSecret } from "../secret";

export type Instance = {
  id: number;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InstanceInput = {
  name: string;
  baseUrl: string;
  apiToken: string;
  enabled?: boolean;
};

type InstanceRow = typeof instances.$inferSelect;

function toInstance(row: InstanceRow): Instance {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: Boolean(row.enabled),
    hasToken: row.apiToken.length > 0,
    lastSyncAt: row.lastSyncAt ? toIso(row.lastSyncAt) : null,
    lastSyncError: row.lastSyncError ?? null,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listInstances(): Promise<Instance[]> {
  const rows = await db.query.instances.findMany({
    orderBy: (table) => asc(table.name)
  });
  return rows.map(toInstance);
}

export async function getInstance(id: number): Promise<InstanceRow | null> {
  return await db.query.instances.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  }) ?? null;
}

export async function createInstance(input: InstanceInput): Promise<Instance> {
  const now = nowIso();
  const [row] = await db
    .insert(instances)
    .values({
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim(),
      apiToken: encryptSecret(input.apiToken.trim()),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create instance");
  }

  return toInstance(row);
}

export async function updateInstance(
  id: number,
  input: { name?: string; baseUrl?: string; apiToken?: string; enabled?: boolean }
): Promise<Instance> {
  const existing = await getInstance(id);
  if (!existing) {
    throw new Error("Instance not found");
  }

  const now = nowIso();
  const [row] = await db
    .update(instances)
    .set({
      name: input.name?.trim() ?? existing.name,
      baseUrl: input.baseUrl?.trim() ?? existing.baseUrl,
      apiToken: input.apiToken !== undefined ? encryptSecret(input.apiToken.trim()) : existing.apiToken,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: now
    })
    .where(eq(instances.id, id))
    .returning();

  if (!row) {
    throw new Error("Failed to update instance");
  }

  return toInstance(row);
}

export async function deleteInstance(id: number): Promise<void> {
  await db.delete(instances).where(eq(instances.id, id));
}

export async function recordInstanceSyncResult(id: number, result: { ok: boolean; error?: string | null }) {
  const now = nowIso();
  await db
    .update(instances)
    .set({
      lastSyncAt: now,
      lastSyncError: result.ok ? null : result.error ?? "Unknown sync error",
      updatedAt: now
    })
    .where(eq(instances.id, id));
}
