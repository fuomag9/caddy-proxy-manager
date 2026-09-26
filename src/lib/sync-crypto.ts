import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { config } from "./config";

/**
 * Sealing of the secrets in an instance sync payload to the receiving slave.
 *
 * Each slave has an X25519 key pair derived from its SESSION_SECRET and
 * serves the public key on GET /api/instances/sync, together with a
 * single-use nonce. The master seals every secret to that key, so anything
 * that can read the request body on the way (a TLS-terminating proxy in front
 * of the slave, body logging, a passive observer of an HTTP sync) sees only
 * ciphertext. The key changes with SESSION_SECRET; the master fetches it, and
 * a new nonce, before every sync.
 *
 * A sealed value is "sealed:v1:" + base64url(ephemeral public key | IV | tag |
 * ciphertext): a fresh ephemeral X25519 key per value, HKDF-SHA256 over the
 * shared secret (salted with both public keys) as the AES-256-GCM key, and
 * caller-supplied associated data. Instance sync binds each value to its
 * place in the payload, the nonce and the rest of the payload (see
 * instance-sync.ts), so a value opens only where and when it was sealed.
 */

export const SYNC_KEY_VERSION = 1;
export const SYNC_KEY_ALGORITHM = "x25519-hkdf-sha256-aes256gcm";
export const SEALED_SYNC_SECRET_PREFIX = "sealed:v1:";

const KEY_PAIR_INFO = "cpm-instance-sync-x25519:v1";
const SEAL_INFO = "cpm-instance-sync-seal:v1";
// DER encodings of an X25519 key with the 32 raw key bytes appended (RFC 8410).
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PUBLIC_KEY_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const NONCE_BYTES = 16;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// Longer than any master's sync request may take (INSTANCE_SYNC_TIMEOUT_MS is
// at most 5 minutes), so a nonce outlives the sync it was issued for.
const NONCE_TTL_MS = 10 * 60_000;
const MAX_OUTSTANDING_NONCES = 100;

export type SyncSealErrorCode = "invalid_key" | "malformed" | "open_failed" | "key_mismatch" | "stale";

const SEAL_ERROR_MESSAGES: Record<SyncSealErrorCode, string> = {
  invalid_key: "Invalid instance sync public key",
  malformed: "Malformed sealed instance sync secret",
  open_failed: "Sealed instance sync secret could not be opened",
  key_mismatch: "Instance sync payload was sealed for a different key",
  stale: "Instance sync payload was sealed with an unknown, expired or used nonce",
};

/** A sealing failure. The message is fixed and never includes key material. */
export class SyncSealError extends Error {
  readonly code: SyncSealErrorCode;

  constructor(code: SyncSealErrorCode) {
    super(SEAL_ERROR_MESSAGES[code]);
    this.name = "SyncSealError";
    this.code = code;
  }
}

/** A slave's public key: the raw 32 bytes and their key id. */
export type SyncPublicKey = { publicKey: Buffer; keyId: string };

/** What the master seals one sync to: the slave's key and the nonce it issued. */
export type SyncSealTarget = SyncPublicKey & { nonce: string };

/** The body of GET /api/instances/sync. */
export type SyncPublicKeyResponse = {
  version: typeof SYNC_KEY_VERSION;
  algorithm: typeof SYNC_KEY_ALGORITHM;
  /** Raw X25519 public key, base64. */
  publicKey: string;
  keyId: string;
  /** Single-use, for one sync payload; see issueSyncNonce. */
  nonce: string;
};

type SyncKeyPair = SyncPublicKey & { privateKey: KeyObject };

/** The first 16 hex characters of the SHA-256 of a raw public key. */
export function syncKeyId(publicKey: Buffer): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

function rawPublicKey(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" });
  return Buffer.from(der.subarray(X25519_SPKI_PREFIX.length));
}

function importPublicKey(raw: Buffer, failure: SyncSealErrorCode): KeyObject {
  if (raw.length !== KEY_LENGTH) throw new SyncSealError(failure);
  try {
    return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
  } catch {
    throw new SyncSealError(failure);
  }
}

function deriveSyncKeyPair(secret: string): SyncKeyPair {
  const seed = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), KEY_PAIR_INFO, KEY_LENGTH));
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = rawPublicKey(createPublicKey(privateKey));
  return { privateKey, publicKey, keyId: syncKeyId(publicKey) };
}

let cachedKeyPair: { secret: string; keyPair: SyncKeyPair } | null = null;

function currentKeyPair(): SyncKeyPair {
  const secret = config.sessionSecret;
  if (cachedKeyPair?.secret !== secret) {
    cachedKeyPair = { secret, keyPair: deriveSyncKeyPair(secret) };
  }
  return cachedKeyPair.keyPair;
}

/** This instance's sync public key, derived from SESSION_SECRET. */
export function getSyncPublicKey(): SyncPublicKey {
  const { publicKey, keyId } = currentKeyPair();
  return { publicKey: Buffer.from(publicKey), keyId };
}

/** Nonces issued by this process and not yet used, with their expiry times, oldest first. */
const outstandingNonces = new Map<string, number>();

export function isSyncNonce(value: unknown): value is string {
  return typeof value === "string" && NONCE_PATTERN.test(value);
}

/**
 * A fresh nonce for one sync payload, usable once within NONCE_TTL_MS. Only
 * the newest MAX_OUTSTANDING_NONCES stay usable, which bounds the memory used.
 */
export function issueSyncNonce(): string {
  const now = Date.now();
  for (const [nonce, expiresAt] of outstandingNonces) {
    if (expiresAt > now && outstandingNonces.size < MAX_OUTSTANDING_NONCES) break;
    outstandingNonces.delete(nonce);
  }
  const nonce = randomBytes(NONCE_BYTES).toString("base64url");
  outstandingNonces.set(nonce, now + NONCE_TTL_MS);
  return nonce;
}

/** Use up a nonce. True when this process issued it, it has not expired and was not used before. */
export function consumeSyncNonce(nonce: string): boolean {
  const expiresAt = outstandingNonces.get(nonce);
  if (expiresAt === undefined) return false;
  outstandingNonces.delete(nonce);
  return expiresAt > Date.now();
}

/** The body of GET /api/instances/sync: this instance's public key and a new nonce. */
export function createSyncKeyResponse(): SyncPublicKeyResponse {
  const { publicKey, keyId } = currentKeyPair();
  return {
    version: SYNC_KEY_VERSION,
    algorithm: SYNC_KEY_ALGORITHM,
    publicKey: publicKey.toString("base64"),
    keyId,
    nonce: issueSyncNonce(),
  };
}

/**
 * The key and nonce in a slave's GET /api/instances/sync reply, or null when
 * the reply is not a well-formed key of this version and algorithm.
 */
export function parseSyncPublicKeyResponse(body: unknown): SyncSealTarget | null {
  if (typeof body !== "object" || body === null) return null;
  const { version, algorithm, publicKey, keyId, nonce } = body as Record<string, unknown>;
  if (version !== SYNC_KEY_VERSION || algorithm !== SYNC_KEY_ALGORITHM) return null;
  if (typeof publicKey !== "string" || !PUBLIC_KEY_BASE64_PATTERN.test(publicKey)) return null;
  const raw = Buffer.from(publicKey, "base64");
  if (raw.length !== KEY_LENGTH || keyId !== syncKeyId(raw) || !isSyncNonce(nonce)) return null;
  return { publicKey: raw, keyId, nonce };
}

function isAllZero(bytes: Buffer): boolean {
  let accumulated = 0;
  for (const byte of bytes) accumulated |= byte;
  return accumulated === 0;
}

function sealingKey(
  privateKey: KeyObject,
  publicKey: KeyObject,
  ephemeralPublicKey: Buffer,
  recipientPublicKey: Buffer,
  failure: SyncSealErrorCode
): Buffer {
  let shared: Buffer;
  try {
    shared = diffieHellman({ privateKey, publicKey });
  } catch {
    throw new SyncSealError(failure);
  }
  // A low-order public key gives an all-zero shared secret.
  if (isAllZero(shared)) throw new SyncSealError(failure);
  return Buffer.from(
    hkdfSync("sha256", shared, Buffer.concat([ephemeralPublicKey, recipientPublicKey]), SEAL_INFO, KEY_LENGTH)
  );
}

export function isSealedSyncSecret(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(SEALED_SYNC_SECRET_PREFIX);
}

/**
 * Seal `plaintext` to a slave's raw public key. `aad` names the value's place
 * in the payload; opening requires the same string.
 */
export function sealSyncSecret(plaintext: string, recipientPublicKey: Buffer, aad: string): string {
  const recipient = importPublicKey(recipientPublicKey, "invalid_key");
  const ephemeral = generateKeyPairSync("x25519");
  const ephemeralPublicKey = rawPublicKey(ephemeral.publicKey);
  const key = sealingKey(ephemeral.privateKey, recipient, ephemeralPublicKey, recipientPublicKey, "invalid_key");

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const sealed = Buffer.concat([ephemeralPublicKey, iv, cipher.getAuthTag(), ciphertext]);
  return `${SEALED_SYNC_SECRET_PREFIX}${sealed.toString("base64url")}`;
}

/**
 * Open a value sealed to this instance's key. Throws SyncSealError when the
 * value is malformed, was sealed to another key, was changed, or was sealed
 * with other associated data.
 */
export function openSyncSecret(sealed: string, aad: string): string {
  if (!isSealedSyncSecret(sealed)) throw new SyncSealError("malformed");
  const encoded = sealed.slice(SEALED_SYNC_SECRET_PREFIX.length);
  if (!BASE64URL_PATTERN.test(encoded)) throw new SyncSealError("malformed");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length < KEY_LENGTH + IV_LENGTH + TAG_LENGTH) throw new SyncSealError("malformed");

  const ephemeralPublicKey = bytes.subarray(0, KEY_LENGTH);
  const iv = bytes.subarray(KEY_LENGTH, KEY_LENGTH + IV_LENGTH);
  const tag = bytes.subarray(KEY_LENGTH + IV_LENGTH, KEY_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = bytes.subarray(KEY_LENGTH + IV_LENGTH + TAG_LENGTH);

  const own = currentKeyPair();
  const ephemeral = importPublicKey(ephemeralPublicKey, "open_failed");
  const key = sealingKey(own.privateKey, ephemeral, ephemeralPublicKey, own.publicKey, "open_failed");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new SyncSealError("open_failed");
  }
}
