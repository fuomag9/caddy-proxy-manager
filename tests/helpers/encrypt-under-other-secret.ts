import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** A SESSION_SECRET that differs from the one the tests run with. */
export const OTHER_SESSION_SECRET = 'a-previous-session-secret-that-is-long-enough';

/**
 * Encrypt the way src/lib/secret.ts does, but under a different
 * SESSION_SECRET, to simulate a value stored before the secret was changed.
 */
export function encryptUnderOtherSecret(value: string, secret = OTHER_SESSION_SECRET): string {
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'caddy-proxy-manager:secret:v1', 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
