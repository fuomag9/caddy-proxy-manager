import { hkdfSync, createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return Buffer.from(
    hkdfSync("sha256", config.sessionSecret, Buffer.alloc(0), "caddy-proxy-manager:secret:v1", 32)
  );
}

function deriveKeyLegacy(): Buffer {
  return createHash("sha256").update(config.sessionSecret).digest();
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(value: string): string {
  if (!value) return "";
  if (isEncryptedSecret(value)) return value;

  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(value: string): string {
  if (!value) return "";
  if (!isEncryptedSecret(value)) return value;

  // Try new HKDF key first, fall back to old SHA-256 key for existing data.
  // Log when the legacy path is taken so operators know when re-encryption is complete.
  try {
    return _decryptWithKey(value, deriveKey());
  } catch {
    console.warn("[secret] HKDF decryption failed; retrying with legacy SHA-256 key. Re-encrypt this secret to remove the legacy key dependency.");
    return _decryptWithKey(value, deriveKeyLegacy());
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
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString("utf8");
}
