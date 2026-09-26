import { eq } from "drizzle-orm";
import db, { nowIso } from "./db";
import { settings } from "./db/schema";
import { decodeSyncPublicKey, isSyncKeyId, syncKeyId } from "./sync-crypto";
import { UNREADABLE_SYNC_KEY_PIN_SOURCE } from "./instance-sync-view";

/**
 * The sync keys a master has pinned for its slaves (trust on first use).
 *
 * The first key a slave presents is pinned; after that the master seals only
 * to the pinned key, or to a new key the slave proves with the pinned one
 * (see verifySyncKeyRotationProof in sync-crypto.ts). An admin can also pin a
 * key read from the slave. A slave is identified by its base URL (see
 * syncKeyPinIdentity), whether it is an instance or an INSTANCE_SLAVES entry,
 * so pointing an instance at another URL starts with a new pin.
 *
 * Pins are kept on the master only, in one settings row. Instance sync sends
 * named settings groups only and the settings API serves named groups only,
 * so neither includes it.
 */
export const SYNC_KEY_PINS_SETTING = "instance_sync_key_pins";

/** Why a key was pinned: the first key the slave presented, a proven rotation, or an admin's choice. */
export type SyncKeyPinSource = "first-use" | "rotation" | "manual";

export { UNREADABLE_SYNC_KEY_PIN_SOURCE };

export type SyncKeyPin = {
  keyId: string;
  /** Raw X25519 public key, base64. */
  publicKey: string;
  /** ISO 8601. */
  pinnedAt: string;
  /**
   * A SyncKeyPinSource for pins this release writes; kept as stored
   * otherwise, since it plays no part in checking a key. See also
   * UNREADABLE_SYNC_KEY_PIN_SOURCE.
   */
  source: string;
};

export type SyncKeyPinEntry = SyncKeyPin & {
  /** The slave's normalized base URL; see syncKeyPinIdentity. */
  identity: string;
};

/** What to pin: the raw public key (a Buffer, or base64) and why it is pinned. */
export type SyncKeyPinInput = { publicKey: Buffer | string; source: SyncKeyPinSource };

const PUBLIC_KEY_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const SOURCES: ReadonlySet<string> = new Set<SyncKeyPinSource>(["first-use", "rotation", "manual"]);

/** Whether `pin` stands for a stored entry this release cannot read; see UNREADABLE_SYNC_KEY_PIN_SOURCE. */
export function isUnreadableSyncKeyPin(pin: SyncKeyPin): boolean {
  return pin.source === UNREADABLE_SYNC_KEY_PIN_SOURCE;
}

/**
 * The key a slave's pin is stored under: its base URL as the URL parser
 * normalizes it (scheme and host lowercased, default port removed, dot
 * segments resolved) without trailing slashes. Instance sync requests go to
 * this value + "/api/instances/sync" (see slaveSyncUrl in instance-sync.ts),
 * so two base URLs share a pin exactly when they reach the same endpoint.
 * The identity of an identity is itself.
 */
export function syncKeyPinIdentity(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function isSyncKeyPin(value: unknown): value is SyncKeyPin {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { keyId, publicKey, pinnedAt, source } = value as Record<string, unknown>;
  if (!isSyncKeyId(keyId) || typeof pinnedAt !== "string") return false;
  if (typeof source !== "string" || source === UNREADABLE_SYNC_KEY_PIN_SOURCE) return false;
  if (typeof publicKey !== "string" || !PUBLIC_KEY_BASE64_PATTERN.test(publicKey)) return false;
  // Only the format: a key is checked for use in a key exchange when it is
  // pinned (see toPin), not on every read. One that is not usable (a
  // low-order point, stored by other means) matches no key a slave can
  // present, since parseSyncPublicKeyResponse refuses those.
  const raw = Buffer.from(publicKey, "base64");
  return raw.length === 32 && syncKeyId(raw) === keyId;
}

/** The value each unreadable entry was stored as, so writes keep it as it was. */
const storedUnreadableEntries = new WeakMap<SyncKeyPin, unknown>();

/**
 * The stored pins. An entry that is not a well-formed pin is kept as an
 * unreadable pin (see UNREADABLE_SYNC_KEY_PIN_SOURCE), never dropped: a slave
 * whose pin cannot be read is not pinned again on first use. A row that is
 * not a JSON object holds no pins.
 */
function parsePins(serialized: string | undefined): Map<string, SyncKeyPin> {
  const pins = new Map<string, SyncKeyPin>();
  if (!serialized) return pins;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return pins;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return pins;
  for (const [identity, pin] of Object.entries(value)) {
    if (isSyncKeyPin(pin)) {
      pins.set(identity, { keyId: pin.keyId, publicKey: pin.publicKey, pinnedAt: pin.pinnedAt, source: pin.source });
    } else {
      const pinnedAt = (pin as { pinnedAt?: unknown } | null)?.pinnedAt;
      const unreadable: SyncKeyPin = {
        keyId: "",
        publicKey: "",
        pinnedAt: typeof pinnedAt === "string" ? pinnedAt : "",
        source: UNREADABLE_SYNC_KEY_PIN_SOURCE,
      };
      storedUnreadableEntries.set(unreadable, pin);
      pins.set(identity, unreadable);
    }
  }
  return pins;
}

function serializePins(pins: Map<string, SyncKeyPin>): string {
  return JSON.stringify(Object.fromEntries(
    [...pins].map(([identity, pin]) => [
      identity,
      storedUnreadableEntries.has(pin) ? storedUnreadableEntries.get(pin) : pin,
    ])
  ));
}

function toPin(input: SyncKeyPinInput): SyncKeyPin {
  const raw = decodeSyncPublicKey(
    typeof input.publicKey === "string" ? input.publicKey : input.publicKey.toString("base64")
  );
  if (!raw) throw new Error("Invalid sync public key");
  if (!SOURCES.has(input.source)) throw new Error("Invalid sync key pin source");
  return { keyId: syncKeyId(raw), publicKey: raw.toString("base64"), pinnedAt: nowIso(), source: input.source };
}

async function readPins(): Promise<Map<string, SyncKeyPin>> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SYNC_KEY_PINS_SETTING));
  return parsePins(row?.value);
}

/** Every stored pin, unreadable ones included, ordered by identity. */
export async function listSyncKeyPins(): Promise<SyncKeyPinEntry[]> {
  return [...(await readPins())]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([identity, pin]) => ({ identity, ...pin }));
}

/** The pin of the slave at `baseUrl` (possibly an unreadable one), or null when it has none. */
export async function getSyncKeyPin(baseUrl: string): Promise<SyncKeyPin | null> {
  return (await readPins()).get(syncKeyPinIdentity(baseUrl)) ?? null;
}

/**
 * Run `change` on the stored pins inside one synchronous transaction and
 * store the result when it differs, so concurrent syncs (one per slave, in
 * parallel) never overwrite each other's pins.
 */
function changePins<T>(change: (pins: Map<string, SyncKeyPin>) => T): T {
  return db.transaction((tx) => {
    const row = tx.select({ value: settings.value }).from(settings).where(eq(settings.key, SYNC_KEY_PINS_SETTING)).get();
    const pins = parsePins(row?.value);
    const before = serializePins(pins);
    const result = change(pins);
    const value = serializePins(pins);
    if (value === before) return result;
    if (pins.size === 0) {
      tx.delete(settings).where(eq(settings.key, SYNC_KEY_PINS_SETTING)).run();
    } else {
      const updatedAt = nowIso();
      tx.insert(settings)
        .values({ key: SYNC_KEY_PINS_SETTING, value, updatedAt })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
        .run();
    }
    return result;
  });
}

/**
 * Read the pin of the slave at `baseUrl` and, when `decide` returns a `pin`,
 * replace it, in one transaction. Returns `decide`'s `result`. `decide` runs
 * inside the transaction and must not await.
 */
export function updateSyncKeyPin<T>(
  baseUrl: string,
  decide: (current: SyncKeyPin | null) => { result: T; pin?: SyncKeyPinInput }
): T {
  const identity = syncKeyPinIdentity(baseUrl);
  return changePins((pins) => {
    const { result, pin } = decide(pins.get(identity) ?? null);
    if (pin) pins.set(identity, toPin(pin));
    return result;
  });
}

/**
 * Pin `input` for the slave at `baseUrl`, replacing any pin it has. Throws,
 * writing nothing, when the key is not a usable X25519 public key (see
 * decodeSyncPublicKey). Returns the new pin and the one it replaced, or null.
 */
export async function replaceSyncKeyPin(
  baseUrl: string,
  input: SyncKeyPinInput
): Promise<{ pin: SyncKeyPin; replaced: SyncKeyPin | null }> {
  const identity = syncKeyPinIdentity(baseUrl);
  const pin = toPin(input);
  const replaced = changePins((pins) => {
    const previous = pins.get(identity) ?? null;
    pins.set(identity, pin);
    return previous;
  });
  return { pin, replaced };
}

/** Pin `input` for the slave at `baseUrl`, like replaceSyncKeyPin. Returns the new pin. */
export async function setSyncKeyPin(baseUrl: string, input: SyncKeyPinInput): Promise<SyncKeyPin> {
  return (await replaceSyncKeyPin(baseUrl, input)).pin;
}

/**
 * Remove the pin of the slave at `baseUrl`, so the next sync pins the key it
 * presents. Returns whether there was one.
 */
export async function deleteSyncKeyPin(baseUrl: string): Promise<boolean> {
  return (await takeSyncKeyPin(baseUrl)) !== null;
}

/**
 * Remove the pin of the slave at `baseUrl`, like deleteSyncKeyPin, and return
 * the pin that was removed, or null when there was none. When `keep` returns
 * true for the identity the pin stays and null is returned; `keep` runs inside
 * the store's transaction (it must not await), so it decides on the state the
 * removal is made against.
 */
export async function takeSyncKeyPin(
  baseUrl: string,
  keep?: (identity: string) => boolean
): Promise<SyncKeyPin | null> {
  const identity = syncKeyPinIdentity(baseUrl);
  return changePins((pins) => {
    const pin = pins.get(identity) ?? null;
    if (!pin || keep?.(identity)) return null;
    pins.delete(identity);
    return pin;
  });
}
