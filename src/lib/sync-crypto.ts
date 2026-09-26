import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { config, DISALLOWED_SESSION_SECRETS } from "./config";

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
 *
 * The master pins each slave's key on first use (see
 * instance-sync-key-pins.ts). So that a slave whose SESSION_SECRET was rotated
 * the documented way (the old value in SESSION_SECRET_PREVIOUS) is re-pinned
 * without the operator's help, the master sends a challenge with the key
 * request, `?challenge=` + base64url(a fresh ephemeral X25519 public key), and
 * the slave answers with a rotation proof from each key derived from
 * SESSION_SECRET_PREVIOUS: HMAC-SHA256 over its current public key and the
 * nonce, keyed with HKDF-SHA256 over the X25519 shared secret of that previous
 * key and the challenge (salted with the challenge and the previous public
 * key). Only the holder of a previous private key, or of the challenge's,
 * can compute it, and it is good for this challenge, key and nonce only.
 */

export const SYNC_KEY_VERSION = 1;
export const SYNC_KEY_ALGORITHM = "x25519-hkdf-sha256-aes256gcm";
export const SEALED_SYNC_SECRET_PREFIX = "sealed:v1:";

export const SYNC_KEY_CHALLENGE_PARAM = "challenge";
/** The most rotation proofs a slave sends, and a master looks at. */
const MAX_SYNC_KEY_ROTATION_PROOFS = 8;

const KEY_PAIR_INFO = "cpm-instance-sync-x25519:v1";
// A sealing key and a rotation proof key can come from the same X25519 shared
// secret and the same salt: a sealed value's ephemeral key, sent back as a
// challenge, gives the salt that value was sealed with. Only these HKDF info
// strings separate the two keys, so they must stay distinct.
const SEAL_INFO = "cpm-instance-sync-seal:v1";
const ROTATION_PROOF_INFO = "cpm-instance-sync-key-rotation:v1";
// DER encodings of an X25519 key with the 32 raw key bytes appended (RFC 8410).
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const PUBLIC_KEY_BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
// 32 bytes, base64url without padding: a challenge key or an HMAC-SHA256.
const BASE64URL_32_BYTES_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_BYTES = 16;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// Longer than any master's sync request may take (INSTANCE_SYNC_TIMEOUT_MS is
// at most 5 minutes), so a nonce outlives the sync it was issued for.
const NONCE_TTL_MS = 10 * 60_000;
const MAX_OUTSTANDING_NONCES = 100;

export type SyncSealErrorCode =
  | "invalid_key"
  | "invalid_challenge"
  | "malformed"
  | "open_failed"
  | "key_mismatch"
  | "stale";

const SEAL_ERROR_MESSAGES: Record<SyncSealErrorCode, string> = {
  invalid_key: "Invalid instance sync public key",
  invalid_challenge: "Invalid instance sync key challenge",
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

/** Proof that the slave holds the private key of `keyId`, a key it had before. */
export type SyncKeyRotationProof = {
  keyId: string;
  /** HMAC-SHA256, base64url; see createSyncKeyResponse. */
  proof: string;
};

/** The body of GET /api/instances/sync. */
export type SyncPublicKeyResponse = {
  version: typeof SYNC_KEY_VERSION;
  algorithm: typeof SYNC_KEY_ALGORITHM;
  /** Raw X25519 public key, base64. */
  publicKey: string;
  keyId: string;
  /** Single-use, for one sync payload; see issueSyncNonce. */
  nonce: string;
  /**
   * Only for a challenge, and only when SESSION_SECRET_PREVIOUS holds a secret
   * other than SESSION_SECRET and the public placeholders: one proof per
   * previous key.
   */
  rotationProofs?: SyncKeyRotationProof[];
};

/** A master's challenge for one key request: a fresh ephemeral X25519 key pair. */
export type SyncKeyChallenge = {
  /** The raw public key, base64url, as sent in `?challenge=`. */
  value: string;
  publicKey: Buffer;
  privateKey: KeyObject;
};

type SyncKeyPair = SyncPublicKey & { privateKey: KeyObject };

/** The first 16 hex characters of the SHA-256 of a raw public key. */
export function syncKeyId(publicKey: Buffer): string {
  return createHash("sha256").update(publicKey).digest("hex").slice(0, 16);
}

export function isSyncKeyId(value: unknown): value is string {
  return typeof value === "string" && KEY_ID_PATTERN.test(value);
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

let cachedPreviousKeyPairs: { secrets: string; keyPairs: SyncKeyPair[] } | null = null;

/**
 * The key pairs derived from SESSION_SECRET_PREVIOUS, without duplicates and
 * the current key, at most MAX_SYNC_KEY_ROTATION_PROOFS. The public
 * placeholder secrets are left out: their private keys are public, so a
 * proof made with one would prove nothing. The comma-separated secrets come
 * first; an entry holding a comma (the whole value, kept in case a secret
 * contains one) only gets a slot that is left.
 */
function previousKeyPairs(): SyncKeyPair[] {
  const current = currentKeyPair();
  const secrets = config.previousSessionSecrets
    .filter((secret) => secret !== config.sessionSecret && !DISALLOWED_SESSION_SECRETS.has(secret))
    .sort((a, b) => Number(a.includes(",")) - Number(b.includes(",")));
  const cacheKey = JSON.stringify([config.sessionSecret, secrets]);
  if (cachedPreviousKeyPairs?.secrets !== cacheKey) {
    const keyPairs = new Map<string, SyncKeyPair>();
    for (const secret of secrets) {
      if (keyPairs.size >= MAX_SYNC_KEY_ROTATION_PROOFS) break;
      const keyPair = deriveSyncKeyPair(secret);
      if (keyPair.keyId !== current.keyId && !keyPairs.has(keyPair.keyId)) keyPairs.set(keyPair.keyId, keyPair);
    }
    cachedPreviousKeyPairs = { secrets: cacheKey, keyPairs: [...keyPairs.values()] };
  }
  return cachedPreviousKeyPairs.keyPairs;
}

let placeholderPublicKeys: Buffer[] | null = null;

/** Whether a key is derived from one of the public placeholder secrets. */
function isPlaceholderSyncKey(publicKey: Buffer): boolean {
  placeholderPublicKeys ??= [...DISALLOWED_SESSION_SECRETS].map((secret) => deriveSyncKeyPair(secret).publicKey);
  return placeholderPublicKeys.some((placeholder) => placeholder.equals(publicKey));
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

/**
 * The body of GET /api/instances/sync: this instance's public key and a new
 * nonce. With a master's `challenge` (see createSyncKeyChallenge), also a
 * rotation proof from each key derived from SESSION_SECRET_PREVIOUS:
 *
 *   HMAC-SHA256(HKDF-SHA256(X25519(previous private key, challenge),
 *                           salt = challenge | previous public key,
 *                           info = "cpm-instance-sync-key-rotation:v1"),
 *               current public key | nonce)
 *
 * with raw 32-byte keys and the nonce as sent. Throws SyncSealError
 * ("invalid_challenge"), before a nonce is issued, when the challenge is not
 * 32 bytes of base64url or, once a proof uses it, is not a usable key (a
 * low-order point gives an all-zero shared secret).
 */
export function createSyncKeyResponse(challenge?: string | null): SyncPublicKeyResponse {
  const { publicKey, keyId } = currentKeyPair();
  const proofKeys = challenge === undefined || challenge === null ? [] : rotationProofKeys(challenge);
  const response: SyncPublicKeyResponse = {
    version: SYNC_KEY_VERSION,
    algorithm: SYNC_KEY_ALGORITHM,
    publicKey: publicKey.toString("base64"),
    keyId,
    nonce: issueSyncNonce(),
  };
  if (proofKeys.length > 0) {
    response.rotationProofs = proofKeys.map((proofKey) => ({
      keyId: proofKey.keyId,
      proof: rotationProof(proofKey.key, publicKey, response.nonce).toString("base64url"),
    }));
  }
  return response;
}

/** The HMAC key of a rotation proof from each previous key, for this challenge. */
function rotationProofKeys(challenge: string): Array<{ keyId: string; key: Buffer }> {
  if (!BASE64URL_32_BYTES_PATTERN.test(challenge)) throw new SyncSealError("invalid_challenge");
  const challengePublicKey = Buffer.from(challenge, "base64url");
  const challengeKey = importPublicKey(challengePublicKey, "invalid_challenge");
  return previousKeyPairs().map((previous) => ({
    keyId: previous.keyId,
    key: sharedKey(
      previous.privateKey,
      challengeKey,
      Buffer.concat([challengePublicKey, previous.publicKey]),
      ROTATION_PROOF_INFO,
      "invalid_challenge"
    ),
  }));
}

function rotationProof(key: Buffer, currentPublicKey: Buffer, nonce: string): Buffer {
  return createHmac("sha256", key).update(currentPublicKey).update(nonce, "utf8").digest();
}

/** A fresh challenge for one key request, sent as `?challenge=` + `value`. */
export function createSyncKeyChallenge(): SyncKeyChallenge {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const raw = rawPublicKey(publicKey);
  return { value: raw.toString("base64url"), publicKey: raw, privateKey };
}

/**
 * The well-formed rotation proofs in a slave's key reply. A reply with more
 * than MAX_SYNC_KEY_ROTATION_PROOFS has none: a slave never sends more.
 */
export function parseSyncKeyRotationProofs(body: unknown): SyncKeyRotationProof[] {
  if (typeof body !== "object" || body === null) return [];
  const { rotationProofs } = body as Record<string, unknown>;
  if (!Array.isArray(rotationProofs) || rotationProofs.length > MAX_SYNC_KEY_ROTATION_PROOFS) return [];
  const proofs: SyncKeyRotationProof[] = [];
  for (const entry of rotationProofs) {
    if (typeof entry !== "object" || entry === null) continue;
    const { keyId, proof } = entry as Record<string, unknown>;
    if (isSyncKeyId(keyId) && typeof proof === "string" && BASE64URL_32_BYTES_PATTERN.test(proof)) {
      proofs.push({ keyId, proof });
    }
  }
  return proofs;
}

/**
 * Whether the slave proved, for this challenge, that the holder of the
 * `pinned` key also holds the key it `presented` with its nonce. Only the
 * first proof for the pinned key id is checked. A pinned key derived from a
 * public placeholder secret proves nothing, since its private key is public.
 */
export function verifySyncKeyRotationProof(
  challenge: SyncKeyChallenge,
  pinned: SyncPublicKey,
  presented: SyncSealTarget,
  proofs: readonly SyncKeyRotationProof[]
): boolean {
  const entry = proofs.find((proof) => proof.keyId === pinned.keyId);
  if (!entry || !BASE64URL_32_BYTES_PATTERN.test(entry.proof)) return false;
  if (pinned.keyId !== syncKeyId(pinned.publicKey) || isPlaceholderSyncKey(pinned.publicKey)) return false;
  let key: Buffer;
  try {
    key = sharedKey(
      challenge.privateKey,
      importPublicKey(pinned.publicKey, "invalid_key"),
      Buffer.concat([challenge.publicKey, pinned.publicKey]),
      ROTATION_PROOF_INFO,
      "invalid_key"
    );
  } catch (error) {
    if (error instanceof SyncSealError) return false;
    throw error;
  }
  const expected = rotationProof(key, presented.publicKey, presented.nonce);
  return timingSafeEqual(expected, Buffer.from(entry.proof, "base64url"));
}

/**
 * The key and nonce in a slave's GET /api/instances/sync reply, or null when
 * the reply is not a well-formed key of this version and algorithm, or the
 * key is one the key exchange refuses (see decodeSyncPublicKey). The key is
 * checked here, not only when something is sealed to it, so that a key
 * nothing could be sealed to is never pinned, whatever the payload holds.
 */
export function parseSyncPublicKeyResponse(body: unknown): SyncSealTarget | null {
  if (typeof body !== "object" || body === null) return null;
  const { version, algorithm, publicKey, keyId, nonce } = body as Record<string, unknown>;
  if (version !== SYNC_KEY_VERSION || algorithm !== SYNC_KEY_ALGORITHM) return null;
  const raw = decodeSyncPublicKey(publicKey);
  if (!raw || keyId !== syncKeyId(raw) || !isSyncNonce(nonce)) return null;
  return { publicKey: raw, keyId, nonce };
}

/**
 * A raw X25519 public key given as base64 (43 characters and "="), or null
 * when `value` is not one, or is a key the key exchange refuses: a low-order
 * point, which gives the same all-zero shared secret with every private key,
 * so anything sealed to it could be opened by anyone.
 */
export function decodeSyncPublicKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || !PUBLIC_KEY_BASE64_PATTERN.test(value)) return null;
  const raw = Buffer.from(value, "base64");
  if (raw.length !== KEY_LENGTH) return null;
  try {
    // The scalar of an X25519 private key is a multiple of 8, so a random one
    // gives the all-zero shared secret exactly for the low-order points.
    x25519(generateKeyPairSync("x25519").privateKey, importPublicKey(raw, "invalid_key"), "invalid_key");
  } catch (error) {
    if (error instanceof SyncSealError) return null;
    throw error;
  }
  return raw;
}

function isAllZero(bytes: Buffer): boolean {
  let accumulated = 0;
  for (const byte of bytes) accumulated |= byte;
  return accumulated === 0;
}

/** The X25519 shared secret of two keys; never the all-zero one. */
function x25519(privateKey: KeyObject, publicKey: KeyObject, failure: SyncSealErrorCode): Buffer {
  let shared: Buffer;
  try {
    shared = diffieHellman({ privateKey, publicKey });
  } catch {
    throw new SyncSealError(failure);
  }
  // A low-order public key gives an all-zero shared secret.
  if (isAllZero(shared)) throw new SyncSealError(failure);
  return shared;
}

/** HKDF-SHA256 over the X25519 shared secret of two keys. */
function sharedKey(
  privateKey: KeyObject,
  publicKey: KeyObject,
  salt: Buffer,
  info: string,
  failure: SyncSealErrorCode
): Buffer {
  const shared = x25519(privateKey, publicKey, failure);
  return Buffer.from(hkdfSync("sha256", shared, salt, info, KEY_LENGTH));
}

function sealingKey(
  privateKey: KeyObject,
  publicKey: KeyObject,
  ephemeralPublicKey: Buffer,
  recipientPublicKey: Buffer,
  failure: SyncSealErrorCode
): Buffer {
  return sharedKey(privateKey, publicKey, Buffer.concat([ephemeralPublicKey, recipientPublicKey]), SEAL_INFO, failure);
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
