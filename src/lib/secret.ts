import { hkdfSync, createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config, DISALLOWED_SESSION_SECRETS } from "./config";

export const ENCRYPTED_SECRET_PREFIX = "enc:v1:";
const PREFIX = ENCRYPTED_SECRET_PREFIX;
const IV_LENGTH = 12;

function hkdfKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", secret, Buffer.alloc(0), "caddy-proxy-manager:secret:v1", 32)
  );
}

function legacyKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function deriveKey(): Buffer {
  return hkdfKey(config.sessionSecret);
}

/**
 * Secrets whose keys may still decrypt stored values but never encrypt new
 * ones: SESSION_SECRET_PREVIOUS after a rotation, and the public placeholders
 * older installs ran with (trying a publicly known key reveals nothing).
 */
function previousSecrets(): string[] {
  const secrets = new Set([...config.previousSessionSecrets, ...DISALLOWED_SESSION_SECRETS]);
  secrets.delete(config.sessionSecret);
  return [...secrets];
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

function encryptWithCurrentKey(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function encryptSecret(value: string): string {
  if (!value) return "";
  if (isEncryptedSecret(value)) return value;
  return encryptWithCurrentKey(value);
}

/**
 * Legacy fallback is time-limited. After the migration grace period,
 * the legacy key is no longer tried, forcing re-encryption of old secrets.
 * Set LEGACY_KEY_CUTOFF_DATE env var to extend/disable (ISO 8601 date or "never").
 */
const LEGACY_KEY_CUTOFF_ENV = process.env.LEGACY_KEY_CUTOFF_DATE;
const LEGACY_KEY_CUTOFF = LEGACY_KEY_CUTOFF_ENV === "never"
  ? null
  : new Date(LEGACY_KEY_CUTOFF_ENV || "2026-06-01T00:00:00Z");

function legacyKeyAllowed(): boolean {
  return !LEGACY_KEY_CUTOFF || new Date() <= LEGACY_KEY_CUTOFF;
}

type FallbackDecryption = { plaintext: string; source: "legacy" | "previous" };

/**
 * Decrypt a value that the current HKDF key could not: with the legacy key
 * of the current secret (during the grace period), then with the keys of
 * every previous secret. Throws with a recovery hint when nothing works.
 */
function decryptWithFallbackKeys(
  value: string,
  context: string | undefined,
  currentKeyError: unknown
): FallbackDecryption {
  const withLegacy = legacyKeyAllowed();
  let lastError = currentKeyError;

  if (withLegacy) {
    try {
      return { plaintext: _decryptWithKey(value, legacyKey(config.sessionSecret)), source: "legacy" };
    } catch (error) {
      lastError = error;
    }
  }
  for (const secret of previousSecrets()) {
    const keys = withLegacy ? [hkdfKey(secret), legacyKey(secret)] : [hkdfKey(secret)];
    for (const key of keys) {
      try {
        return { plaintext: _decryptWithKey(value, key), source: "previous" };
      } catch (error) {
        lastError = error;
      }
    }
  }

  const label = context ? ` for ${context}` : "";
  const recoveryHint =
    "This usually happens when SESSION_SECRET changed after the value was stored. " +
    "Fix: set SESSION_SECRET_PREVIOUS to the secret the value was stored with and recreate the web container " +
    "(docker compose up -d; values stored locally are then re-encrypted with the current key at startup), " +
    "or re-enter the affected token/secret in the UI.";

  if (!withLegacy) {
    throw new Error(
      `[secret] Failed to decrypt stored secret${label}: decryption failed with the current key and SESSION_SECRET_PREVIOUS, ` +
      "and the legacy key grace period has expired. " +
      recoveryHint + " " +
      "Set LEGACY_KEY_CUTOFF_DATE=never to temporarily restore legacy key support.",
      { cause: lastError }
    );
  }
  throw new Error(
    `[secret] Failed to decrypt stored secret${label}: decryption failed with the current (HKDF) and legacy keys ` +
    "and with SESSION_SECRET_PREVIOUS. " +
    recoveryHint,
    { cause: lastError }
  );
}

/**
 * Decrypt a value that was encrypted with encryptSecret.
 *
 * @param context Optional human-readable label describing what is being
 * decrypted (e.g. `DNS provider "cloudflare" credential "api_token"`).
 * Included in error messages so users can tell which stored value failed.
 */
export function decryptSecret(value: string, context?: string): string {
  if (!value) return "";
  if (!isEncryptedSecret(value)) return value;

  try {
    return _decryptWithKey(value, deriveKey());
  } catch (currentKeyError: unknown) {
    const { plaintext, source } = decryptWithFallbackKeys(value, context, currentKeyError);
    console.warn(
      source === "legacy"
        ? "[secret] Decrypted a stored secret with the legacy SHA-256 key. Re-encrypt this secret to remove the legacy key dependency."
        : "[secret] Decrypted a stored secret with a previous SESSION_SECRET. Keep SESSION_SECRET_PREVIOUS set until " +
          "startup has re-encrypted it with the current key (on a slave whose master runs an older release, keep it " +
          "while that master sends values encrypted under that secret)."
    );
    return plaintext;
  }
}

/**
 * Re-encrypt a stored value with the current key when only the legacy key or
 * a previous secret decrypts it. Returns null when the value is not encrypted
 * or already uses the current key; throws like decryptSecret when no key
 * decrypts it.
 */
export function reencryptSecret(value: string, context?: string): string | null {
  if (!value || !isEncryptedSecret(value)) return null;
  try {
    _decryptWithKey(value, deriveKey());
    return null;
  } catch (currentKeyError: unknown) {
    const { plaintext } = decryptWithFallbackKeys(value, context, currentKeyError);
    return encryptWithCurrentKey(plaintext);
  }
}

function _decryptWithKey(value: string, key: Buffer): string {
  const payload = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== 16) {
    throw new Error("Invalid authentication tag length");
  }
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}
