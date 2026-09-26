import { eq } from "drizzle-orm";
import db from "./db";
import { accounts, caCertificates, certificates, instances, oauthProviders, settings } from "./db/schema";
import { ENCRYPTED_SECRET_PREFIX, isEncryptedSecret, reencryptSecret } from "./secret";
import { encryptDnsProviderSettingCredentials } from "./dns-providers";
import { encryptCloudflareSettingToken } from "./settings";

/**
 * Settings rows with this prefix hold a master's values on a slave. The slave
 * encrypts their secrets with its own key when a sync stores them, and every
 * sync replaces them.
 */
const SYNCED_SETTINGS_PREFIX = "synced:";

/**
 * Settings rows whose credentials may still be stored in plaintext (the local
 * value and a slave's synced copy), with the function that encrypts them.
 */
const PLAINTEXT_CREDENTIAL_SETTINGS: Array<[string, (value: unknown) => unknown]> = [
  ["dns_provider", encryptDnsProviderSettingCredentials],
  [`${SYNCED_SETTINGS_PREFIX}dns_provider`, encryptDnsProviderSettingCredentials],
  ["cloudflare", encryptCloudflareSettingToken],
  [`${SYNCED_SETTINGS_PREFIX}cloudflare`, encryptCloudflareSettingToken],
];

export type SecretRotationResult = {
  /** Stored values re-encrypted with the current SESSION_SECRET. */
  reencrypted: number;
  /**
   * DNS provider password fields found in plaintext (saved through the REST
   * API or migrated from the legacy Cloudflare setting), now encrypted.
   */
  encryptedPlaintext: number;
  /** Stored values that no known key decrypts; they are left unchanged. */
  failed: number;
  /**
   * OAuth account tokens that no known key decrypts, set to NULL. CPM never
   * reads them, and the user's next OAuth sign-in stores new ones.
   */
  clearedOAuthTokens: number;
};

type Counts = SecretRotationResult;

/**
 * What happens to a value that no known key decrypts: "report" counts it as
 * failed and warns, "clear" sets it to NULL, "keep" leaves it without a
 * warning.
 */
type UndecryptablePolicy = "report" | "clear" | "keep";

/** The value to store instead of the current one; null keeps it. */
type Rotation = { value: string | null } | null;

function reportUndecryptable(context: string) {
  console.warn(
    `[secret] ${context} cannot be decrypted with SESSION_SECRET or SESSION_SECRET_PREVIOUS; ` +
    "re-enter it in the UI or set SESSION_SECRET_PREVIOUS to the secret it was stored with."
  );
}

function rotateValue(value: unknown, context: string, counts: Counts, policy: UndecryptablePolicy): Rotation {
  if (typeof value !== "string" || !isEncryptedSecret(value)) return null;
  try {
    const next = reencryptSecret(value, context);
    return next === null ? null : { value: next };
  } catch {
    if (policy === "clear") return { value: null };
    if (policy === "report") {
      counts.failed += 1;
      reportUndecryptable(context);
    }
    return null;
  }
}

/** Re-encrypt every encrypted string inside a parsed JSON value. */
function rotateNested(
  value: unknown,
  context: string,
  counts: Counts,
  policy: Exclude<UndecryptablePolicy, "clear">,
  pending: { count: number }
): unknown {
  if (typeof value === "string") {
    const rotation = rotateValue(value, context, counts, policy);
    if (rotation === null || rotation.value === null) return value;
    pending.count += 1;
    return rotation.value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rotateNested(item, context, counts, policy, pending));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rotateNested(item, context, counts, policy, pending)])
    );
  }
  return value;
}

async function rotateColumns<Row extends { id: number | string }>(
  label: string,
  rows: Row[],
  columns: readonly (keyof Row & string)[],
  write: (id: Row["id"], updates: Partial<Row>) => Promise<unknown>,
  counts: Counts,
  policy: UndecryptablePolicy = "report"
): Promise<void> {
  for (const row of rows) {
    const updates: Partial<Row> = {};
    let reencrypted = 0;
    let cleared = 0;
    for (const column of columns) {
      const rotation = rotateValue(row[column], `${label} ${row.id} ${column}`, counts, policy);
      if (rotation === null) continue;
      updates[column] = rotation.value as Row[typeof column];
      if (rotation.value === null) cleared += 1;
      else reencrypted += 1;
    }
    if (reencrypted + cleared === 0) continue;
    try {
      await write(row.id, updates);
      counts.reencrypted += reencrypted;
      counts.clearedOAuthTokens += cleared;
    } catch (error) {
      counts.failed += reencrypted;
      console.warn(`[secret] Failed to store re-encrypted ${label} ${row.id}:`, error);
    }
  }
}

/**
 * Re-encrypt every stored encryptSecret value that only a previous key
 * (SESSION_SECRET_PREVIOUS, a rejected placeholder secret or the legacy key)
 * decrypts, so that a SESSION_SECRET rotation needs no manual re-entry.
 * Idempotent; values already under the current key cost one decryption each
 * and are not rewritten. Values no key decrypts are counted and left as-is,
 * except OAuth account tokens, which are cleared, and values in a slave's
 * synced settings, which are left as the master sent them without counting.
 * DNS provider password fields stored in plaintext are encrypted.
 */
export async function reencryptStoredSecrets(): Promise<SecretRotationResult> {
  const counts: Counts = { reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 };

  // Written on every OAuth sign-in and never read by CPM, so a token no key
  // decrypts is dropped instead of reported.
  await rotateColumns(
    "OAuth account",
    await db
      .select({ id: accounts.id, accessToken: accounts.accessToken, refreshToken: accounts.refreshToken, idToken: accounts.idToken })
      .from(accounts),
    ["accessToken", "refreshToken", "idToken"],
    (id, updates) => db.update(accounts).set(updates).where(eq(accounts.id, id)),
    counts,
    "clear"
  );

  await rotateColumns(
    "OAuth provider",
    await db
      .select({ id: oauthProviders.id, clientId: oauthProviders.clientId, clientSecret: oauthProviders.clientSecret })
      .from(oauthProviders),
    ["clientId", "clientSecret"],
    (id, updates) => db.update(oauthProviders).set(updates).where(eq(oauthProviders.id, id)),
    counts
  );

  await rotateColumns(
    "certificate",
    await db.select({ id: certificates.id, privateKeyPem: certificates.privateKeyPem }).from(certificates),
    ["privateKeyPem"],
    (id, updates) => db.update(certificates).set(updates).where(eq(certificates.id, id)),
    counts
  );

  await rotateColumns(
    "CA certificate",
    await db.select({ id: caCertificates.id, privateKeyPem: caCertificates.privateKeyPem }).from(caCertificates),
    ["privateKeyPem"],
    (id, updates) => db.update(caCertificates).set(updates).where(eq(caCertificates.id, id)),
    counts
  );

  await rotateColumns(
    "instance",
    await db.select({ id: instances.id, apiToken: instances.apiToken }).from(instances),
    ["apiToken"],
    (id, updates) => db.update(instances).set(updates).where(eq(instances.id, id)),
    counts
  );

  // Settings (DNS provider credentials, the slave's master token, ...) keep
  // encrypted strings anywhere inside their JSON values. A synced value that
  // no key here decrypts was sent by a master older than this release,
  // encrypted with the master's own SESSION_SECRET; it is left as sent.
  const settingRows = await db.select({ key: settings.key, value: settings.value }).from(settings);
  for (const row of settingRows) {
    if (!row.value.includes(ENCRYPTED_SECRET_PREFIX)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    const policy = row.key.startsWith(SYNCED_SETTINGS_PREFIX) ? "keep" : "report";
    const pending = { count: 0 };
    const next = rotateNested(parsed, `setting "${row.key}"`, counts, policy, pending);
    if (pending.count === 0) continue;
    try {
      await db
        .update(settings)
        .set({ value: JSON.stringify(next) })
        .where(eq(settings.key, row.key));
      counts.reencrypted += pending.count;
    } catch (error) {
      counts.failed += pending.count;
      console.warn(`[secret] Failed to store re-encrypted setting "${row.key}":`, error);
    }
  }

  await encryptPlaintextDnsProviderCredentials(counts);

  return counts;
}

function countEncryptedStrings(value: unknown): number {
  if (typeof value === "string") return isEncryptedSecret(value) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countEncryptedStrings(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum: number, item) => sum + countEncryptedStrings(item), 0);
  }
  return 0;
}

/** Encrypt DNS provider and legacy Cloudflare credentials stored in plaintext. */
async function encryptPlaintextDnsProviderCredentials(counts: Counts): Promise<void> {
  for (const [key, encryptCredentials] of PLAINTEXT_CREDENTIAL_SETTINGS) {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
    if (!row) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      continue;
    }
    const next = encryptCredentials(parsed);
    const encrypted = countEncryptedStrings(next) - countEncryptedStrings(parsed);
    if (encrypted === 0) continue;
    try {
      await db.update(settings).set({ value: JSON.stringify(next) }).where(eq(settings.key, key));
      counts.encryptedPlaintext += encrypted;
    } catch (error) {
      console.warn(`[secret] Failed to store encrypted setting "${key}":`, error);
    }
  }
}
