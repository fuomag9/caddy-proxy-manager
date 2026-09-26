import db, { nowIso, toIso } from "../db";
import { instances } from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { encryptSecret } from "../secret";
import { assertValidInstanceSyncToken } from "../instance-sync-token";
import { sanitizeInstanceSyncError } from "../instance-sync-error";
import { ApiClientError, ApiValidationError } from "../api-errors";
import { logAuditEvent } from "../audit";
import {
  getSyncKeyPin,
  isUnreadableSyncKeyPin,
  listSyncKeyPins,
  replaceSyncKeyPin,
  syncKeyPinIdentity,
  takeSyncKeyPin,
  type SyncKeyPin,
} from "../instance-sync-key-pins";
import { decodeSyncPublicKey } from "../sync-crypto";

export type Instance = {
  id: number;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  /**
   * The sync key pinned for the slave's base URL (see
   * instance-sync-key-pins.ts), or null until a sync, or an admin, pins one.
   */
  syncKeyPin: SyncKeyPin | null;
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

function toInstance(row: InstanceRow, syncKeyPin: SyncKeyPin | null): Instance {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: Boolean(row.enabled),
    hasToken: row.apiToken.length > 0,
    lastSyncAt: row.lastSyncAt ? toIso(row.lastSyncAt) : null,
    lastSyncError: sanitizeInstanceSyncError(row.lastSyncError),
    syncKeyPin,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listInstances(): Promise<Instance[]> {
  const [rows, pins] = await Promise.all([
    db.query.instances.findMany({
      orderBy: (table) => asc(table.name)
    }),
    listSyncKeyPins(),
  ]);
  const pinsByIdentity = new Map(pins.map(({ identity, ...pin }) => [identity, pin]));
  return rows.map((row) => toInstance(row, pinsByIdentity.get(syncKeyPinIdentity(row.baseUrl)) ?? null));
}

/**
 * A slave base URL must be a plain http(s) origin (optionally with a path
 * prefix): no credentials, query or fragment. Sync posts the full config,
 * including decrypted certificate keys, to `${baseUrl}/api/instances/sync`.
 */
export function instanceBaseUrlValidationError(baseUrl: unknown): string | null {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return "Base URL is required";
  const trimmed = baseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Base URL must be a valid URL";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Base URL must use https (or http with INSTANCE_SYNC_ALLOW_HTTP=true)";
  }
  if (parsed.username || parsed.password) return "Base URL must not contain credentials";
  // Checked on the raw string: the URL parser reports a bare trailing "?" or
  // "#" as an empty search/hash, but the sync path would still be appended
  // after it.
  if (/[?#]/.test(trimmed)) return "Base URL must not contain a query string or fragment";
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

  return toInstance(row, await getSyncKeyPin(row.baseUrl));
}

export async function updateInstance(
  id: number,
  input: { name?: string; baseUrl?: string; apiToken?: string; enabled?: boolean },
  actorUserId: number | null = null
): Promise<Instance> {
  if (input.apiToken !== undefined) {
    assertValidInstanceSyncToken(input.apiToken, "Instance API token");
  }
  if (input.baseUrl !== undefined) {
    assertValidInstanceBaseUrl(input.baseUrl);
  }
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) {
    throw new ApiValidationError("Instance name is required");
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new ApiValidationError("enabled must be a boolean");
  }
  const existing = await getInstance(id);
  if (!existing) {
    throw new ApiClientError("Instance not found", 404);
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

  if (syncKeyPinIdentity(existing.baseUrl) !== syncKeyPinIdentity(row.baseUrl)) {
    await releaseSyncKeyPin(existing.baseUrl, row, "base_url_changed", actorUserId);
  }
  return toInstance(row, await getSyncKeyPin(row.baseUrl));
}

export async function deleteInstance(id: number, actorUserId: number | null = null): Promise<void> {
  const existing = await getInstance(id);
  if (!existing) return;
  await db.delete(instances).where(eq(instances.id, id));
  await releaseSyncKeyPin(existing.baseUrl, existing, "instance_deleted", actorUserId);
}

type SyncKeyUnpinReason = "reset" | "instance_deleted" | "base_url_changed";

/** How audit summaries name a pin: by key id, or as unreadable (see UNREADABLE_SYNC_KEY_PIN_SOURCE). */
export function describeSyncKeyPin(pin: SyncKeyPin): string {
  return isUnreadableSyncKeyPin(pin) ? "unreadable sync key pin" : `sync key pin ${pin.keyId}`;
}

/** Audit the removal of a sync key pin, as its pinning is audited (see instance-sync.ts). */
function auditSyncKeyUnpin(
  pin: SyncKeyPin,
  baseUrl: string,
  slave: { id: number; name: string } | null,
  reason: SyncKeyUnpinReason,
  actorUserId: number | null
) {
  const identity = syncKeyPinIdentity(baseUrl);
  const target = slave ? `slave "${slave.name}"` : identity;
  const described = describeSyncKeyPin(pin);
  const summaries: Record<SyncKeyUnpinReason, string> = {
    reset: `Reset ${described} of ${target}`,
    instance_deleted: `Removed ${described} of deleted ${target}`,
    base_url_changed: `Removed ${described} of ${target} after its base URL changed`,
  };
  logAuditEvent({
    userId: actorUserId,
    action: "instance_sync_key_unpinned",
    entityType: "instance",
    entityId: slave?.id ?? null,
    summary: summaries[reason],
    data: { identity, keyId: pin.keyId || null, source: pin.source, reason },
  });
}

/**
 * Remove the sync key pin of `baseUrl`, which `instance` no longer syncs to,
 * unless another instance or an INSTANCE_SLAVES entry still does (pins are
 * kept per slave URL). A slave added at that URL later is then pinned on
 * first use, like any new slave.
 */
async function releaseSyncKeyPin(
  baseUrl: string,
  instance: { id: number; name: string },
  reason: Exclude<SyncKeyUnpinReason, "reset">,
  actorUserId: number | null
): Promise<void> {
  // Loaded here: instance-sync imports this module.
  const { getEnvSlaveInstances } = await import("../instance-sync");
  const envIdentities = new Set(getEnvSlaveInstances().map((slave) => syncKeyPinIdentity(slave.url)));
  const pin = await takeSyncKeyPin(baseUrl, (identity) =>
    envIdentities.has(identity) ||
    // Read inside the pin store's transaction, so an instance added at the
    // URL meanwhile keeps the pin.
    db.select({ baseUrl: instances.baseUrl }).from(instances).all()
      .some((row) => syncKeyPinIdentity(row.baseUrl) === identity)
  );
  if (pin) auditSyncKeyUnpin(pin, baseUrl, instance, reason, actorUserId);
}

/**
 * Reset the sync key pin of instance `id`: remove the pin of its base URL, so
 * the next sync pins whatever key the slave presents, as on first use, and,
 * until then, a slave answering like an older release (HTTP 405) gets the
 * legacy payload. Meant for a slave known to have been re-keyed on purpose;
 * pinning its new key (see pinInstanceSyncKey) leaves no such window.
 * Instances and INSTANCE_SLAVES entries with the same URL share the pin.
 * Returns the removed pin; throws a 404 ApiClientError when there is no such
 * instance or no pin.
 */
export async function resetInstanceSyncKeyPin(id: number, actorUserId: number | null): Promise<SyncKeyPin> {
  const instance = await getInstance(id);
  if (!instance) throw new ApiClientError("Instance not found", 404);
  const pin = await takeSyncKeyPin(instance.baseUrl);
  if (!pin) throw new ApiClientError("Sync key pin not found", 404);
  auditSyncKeyUnpin(pin, instance.baseUrl, instance, "reset", actorUserId);
  return pin;
}

/**
 * Reset the sync key pin of the slave at `baseUrl` (see
 * resetInstanceSyncKeyPin), for INSTANCE_SLAVES entries and for pins no slave
 * uses any more. `baseUrl` may be written in any form that normalizes to the
 * pin's URL, such as the `url` GET /api/v1/instances/sync-key-pins lists.
 * Returns the removed pin; throws a 404 ApiClientError when there is none.
 */
export async function resetSyncKeyPin(baseUrl: string, actorUserId: number | null): Promise<SyncKeyPin> {
  const pin = await takeSyncKeyPin(baseUrl);
  if (!pin) throw new ApiClientError("Sync key pin not found", 404);
  auditSyncKeyUnpin(pin, baseUrl, null, "reset", actorUserId);
  return pin;
}

/** The raw key of a sync public key given in a request, or a 400 ApiValidationError. */
function parsePinnedPublicKey(publicKey: unknown): Buffer {
  const raw = decodeSyncPublicKey(publicKey);
  if (!raw) {
    throw new ApiValidationError(
      "publicKey must be a slave's sync public key: 32 bytes, base64 (as its Settings page and GET /api/v1/instances/sync-key show it)"
    );
  }
  return raw;
}

/** Pin `publicKey` for the slave at `baseUrl` on an admin's word, and audit it. */
async function pinSyncKeyManually(
  baseUrl: string,
  publicKey: unknown,
  slave: { id: number; name: string } | null,
  actorUserId: number | null
): Promise<SyncKeyPin> {
  const raw = parsePinnedPublicKey(publicKey);
  const { pin, replaced } = await replaceSyncKeyPin(baseUrl, { publicKey: raw, source: "manual" });
  const identity = syncKeyPinIdentity(baseUrl);
  logAuditEvent({
    userId: actorUserId,
    action: "instance_sync_key_pinned",
    entityType: "instance",
    entityId: slave?.id ?? null,
    summary: `Pinned sync key ${pin.keyId} of ${slave ? `slave "${slave.name}"` : identity}` +
      (replaced ? `, replacing ${describeSyncKeyPin(replaced)}` : ""),
    data: { identity, keyId: pin.keyId, source: "manual", previousKeyId: replaced ? replaced.keyId || null : null },
  });
  return pin;
}

/**
 * Pin `publicKey` (the slave's sync public key, base64, read from the slave
 * itself) for instance `id`, replacing any pin of its base URL, so the next
 * sync seals to that key only. Unlike a reset, this leaves no sync that
 * trusts whatever key answers. Throws a 404 ApiClientError when there is no
 * such instance and a 400 ApiValidationError for a key that is not usable.
 */
export async function pinInstanceSyncKey(id: number, publicKey: unknown, actorUserId: number | null): Promise<SyncKeyPin> {
  const instance = await getInstance(id);
  if (!instance) throw new ApiClientError("Instance not found", 404);
  return pinSyncKeyManually(instance.baseUrl, publicKey, instance, actorUserId);
}

/**
 * Pin `publicKey` for the slave at `baseUrl` (see pinInstanceSyncKey), for
 * INSTANCE_SLAVES entries and for slaves not added yet. Throws a 400
 * ApiValidationError for a URL a slave could not have or an unusable key.
 */
export async function pinSyncKey(baseUrl: string, publicKey: unknown, actorUserId: number | null): Promise<SyncKeyPin> {
  assertValidInstanceBaseUrl(baseUrl);
  return pinSyncKeyManually(baseUrl, publicKey, null, actorUserId);
}

export type SyncKeyPinSlave =
  | { type: "instance"; id: number; name: string }
  | {
    type: "env";
    name: string;
    /** The entry's own syncKeyId; when set, sync checks it instead of the stored pin. */
    syncKeyId: string | null;
    /** The entry's own syncPublicKey; when set, sync checks it instead of the stored pin. */
    syncPublicKey: string | null;
  };

export type SyncKeyPinListing = SyncKeyPin & {
  /** The normalized slave base URL the pin is kept under (see syncKeyPinIdentity). */
  url: string;
  /** The instances and INSTANCE_SLAVES entries that sync to that URL. */
  slaves: SyncKeyPinSlave[];
};

/** Every stored sync key pin, with the slaves it applies to, ordered by URL. */
export async function listSyncKeyPinsWithSlaves(): Promise<SyncKeyPinListing[]> {
  const [pins, rows] = await Promise.all([
    listSyncKeyPins(),
    db.select({ id: instances.id, name: instances.name, baseUrl: instances.baseUrl })
      .from(instances)
      .orderBy(asc(instances.name)),
  ]);
  const { getEnvSlaveInstances } = await import("../instance-sync");
  const envSlaves = getEnvSlaveInstances();
  return pins.map(({ identity, ...pin }) => ({
    ...pin,
    url: identity,
    slaves: [
      ...rows
        .filter((row) => syncKeyPinIdentity(row.baseUrl) === identity)
        .map((row): SyncKeyPinSlave => ({ type: "instance", id: row.id, name: row.name })),
      ...envSlaves
        .filter((slave) => syncKeyPinIdentity(slave.url) === identity)
        .map((slave): SyncKeyPinSlave => ({
          type: "env",
          name: slave.name,
          syncKeyId: slave.syncKeyId ?? null,
          syncPublicKey: slave.syncPublicKey ?? null,
        })),
    ],
  }));
}

/** `slaves` (INSTANCE_SLAVES entries) with the sync key pin of each one's URL, or null. */
export async function withSyncKeyPins<T extends { url: string }>(
  slaves: T[]
): Promise<Array<T & { syncKeyPin: SyncKeyPin | null }>> {
  if (slaves.length === 0) return [];
  const pins = new Map((await listSyncKeyPins()).map(({ identity, ...pin }) => [identity, pin]));
  return slaves.map((slave) => ({ ...slave, syncKeyPin: pins.get(syncKeyPinIdentity(slave.url)) ?? null }));
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
