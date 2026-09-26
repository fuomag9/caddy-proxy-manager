import type { EnvSlaveInstance } from "./instance-sync";

/**
 * The `source` of a stored sync key pin this release cannot read, for
 * example one a newer release wrote in another format (see
 * instance-sync-key-pins.ts). Its keyId and publicKey are empty, so it
 * matches no key: syncs to the slave fail until the pin is replaced or reset,
 * rather than pinning again on first use. Kept here, with no server-only
 * imports, so the Settings page can use it in the browser.
 */
export const UNREADABLE_SYNC_KEY_PIN_SOURCE = "unreadable";

export type EnvSlaveInstanceView = Pick<EnvSlaveInstance, "name" | "url" | "syncKeyId" | "syncPublicKey">;

/**
 * Environment-configured sync tokens are server-only credentials. Keep the
 * browser payload as an explicit allowlist so new server-side fields cannot
 * start crossing the React Server Component boundary by accident. A syncKeyId
 * is a public key fingerprint and a syncPublicKey a public key, not secrets.
 */
export function toEnvSlaveInstanceView(
  instance: EnvSlaveInstance
): EnvSlaveInstanceView {
  return {
    name: instance.name,
    url: instance.url,
    ...(instance.syncKeyId !== undefined ? { syncKeyId: instance.syncKeyId } : {}),
    ...(instance.syncPublicKey !== undefined ? { syncPublicKey: instance.syncPublicKey } : {}),
  };
}
