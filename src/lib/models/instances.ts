import db, { nowIso, toIso } from "../db";
import { instances } from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { encryptSecret } from "../secret";
import { assertValidInstanceSyncToken } from "../instance-sync-token";
import { sanitizeInstanceSyncError } from "../instance-sync-error";
import { ApiValidationError } from "../api-errors";

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
    lastSyncError: sanitizeInstanceSyncError(row.lastSyncError),
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

/**
 * A slave base URL must be a plain http(s) origin (optionally with a path
 * prefix): no credentials, query or fragment. Sync posts the full config,
 * including decrypted certificate keys, to `${baseUrl}/api/instances/sync`.
 */
export function instanceBaseUrlValidationError(baseUrl: unknown): string | null {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return "Base URL is required";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    return "Base URL must be a valid URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Base URL must use https (or http with INSTANCE_SYNC_ALLOW_HTTP=true)";
  }
  if (parsed.username || parsed.password) return "Base URL must not contain credentials";
  if (parsed.search || parsed.hash) return "Base URL must not contain a query string or fragment";
  return null;
}

function assertValidInstanceBaseUrl(baseUrl: unknown): void {
  const error = instanceBaseUrlValidationError(baseUrl);
  if (error) throw new ApiValidationError(error);
}

export async function getInstance(id: number): Promise<InstanceRow | null> {
  return await db.query.instances.findFirst({
    where: (table, operators) => operators.eq(table.id, id)
  }) ?? null;
}

export async function createInstance(input: InstanceInput): Promise<Instance> {
  assertValidInstanceSyncToken(input.apiToken, "Instance API token");
  assertValidInstanceBaseUrl(input.baseUrl);
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
  if (input.apiToken !== undefined) {
    assertValidInstanceSyncToken(input.apiToken, "Instance API token");
  }
  if (input.baseUrl !== undefined) {
    assertValidInstanceBaseUrl(input.baseUrl);
  }
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
      lastSyncError: result.ok
        ? null
        : sanitizeInstanceSyncError(result.error) ?? "Previous synchronization failed",
      updatedAt: now
    })
    .where(eq(instances.id, id));
}
