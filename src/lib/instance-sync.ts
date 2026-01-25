import db, { nowIso } from "./db";
import { accessListEntries, accessLists, certificates, deadHosts, proxyHosts, redirectHosts } from "./db/schema";
import { getSetting, setSetting } from "./settings";
import { recordInstanceSyncResult, updateInstance } from "./models/instances";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secret";

export type InstanceMode = "standalone" | "master" | "slave";

export type SyncSettings = {
  general: unknown | null;
  cloudflare: unknown | null;
  authentik: unknown | null;
  metrics: unknown | null;
  logging: unknown | null;
  dns: unknown | null;
};

export type SyncPayload = {
  generated_at: string;
  settings: SyncSettings;
  data: {
    certificates: Array<typeof certificates.$inferSelect>;
    accessLists: Array<typeof accessLists.$inferSelect>;
    accessListEntries: Array<typeof accessListEntries.$inferSelect>;
    proxyHosts: Array<typeof proxyHosts.$inferSelect>;
    redirectHosts: Array<typeof redirectHosts.$inferSelect>;
    deadHosts: Array<typeof deadHosts.$inferSelect>;
  };
};

const INSTANCE_MODE_KEY = "instance_mode";
const MASTER_TOKEN_KEY = "instance_master_token";
const SYNCED_PREFIX = "synced:";
const SLAVE_LAST_SYNC_AT_KEY = "instance_last_sync_at";
const SLAVE_LAST_SYNC_ERROR_KEY = "instance_last_sync_error";

/**
 * Environment variable names for instance sync configuration.
 * These take precedence over database settings when set.
 */
const ENV_INSTANCE_MODE = "INSTANCE_MODE";
const ENV_INSTANCE_SYNC_TOKEN = "INSTANCE_SYNC_TOKEN";
const ENV_INSTANCE_SLAVES = "INSTANCE_SLAVES";
const ENV_SYNC_INTERVAL = "INSTANCE_SYNC_INTERVAL";
const ENV_SYNC_ALLOW_HTTP = "INSTANCE_SYNC_ALLOW_HTTP";

/**
 * Type for slave instances configured via environment variable.
 */
export type EnvSlaveInstance = {
  name: string;
  url: string;
  token: string;
};

/**
 * Parses INSTANCE_SLAVES environment variable.
 * Expected format: JSON array of {name, url, token} objects
 * Example: [{"name":"slave1","url":"http://slave:3000","token":"secret"}]
 */
export function getEnvSlaveInstances(): EnvSlaveInstance[] {
  const envValue = process.env[ENV_INSTANCE_SLAVES];
  if (!envValue || envValue.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(envValue);
    if (!Array.isArray(parsed)) {
      console.warn("INSTANCE_SLAVES must be a JSON array");
      return [];
    }

    return parsed.filter((item): item is EnvSlaveInstance => {
      if (typeof item !== "object" || item === null) return false;
      if (typeof item.name !== "string" || item.name.trim().length === 0) return false;
      if (typeof item.url !== "string" || item.url.trim().length === 0) return false;
      if (typeof item.token !== "string" || item.token.trim().length === 0) return false;
      return true;
    });
  } catch (error) {
    console.warn("Failed to parse INSTANCE_SLAVES environment variable:", error);
    return [];
  }
}

/**
 * Gets the sync interval in milliseconds from environment variable.
 * Default is 0 (disabled). Set INSTANCE_SYNC_INTERVAL to enable periodic sync.
 * Value is in seconds.
 */
export function getSyncIntervalMs(): number {
  const envValue = process.env[ENV_SYNC_INTERVAL];
  if (!envValue) return 0;

  const seconds = parseInt(envValue, 10);
  if (isNaN(seconds) || seconds <= 0) return 0;

  // Minimum 30 seconds to prevent abuse
  return Math.max(seconds, 30) * 1000;
}

/**
 * Checks if HTTP sync is explicitly allowed via environment variable.
 * HTTP sync transmits tokens in plaintext and should only be used in trusted networks.
 */
export function isHttpSyncAllowed(): boolean {
  const envValue = process.env[ENV_SYNC_ALLOW_HTTP];
  return envValue === "true" || envValue === "1";
}

/**
 * Checks if a URL uses HTTP (not HTTPS).
 */
function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Checks if instance mode is configured via environment variable.
 * Environment variables take precedence over database settings.
 */
export function isInstanceModeFromEnv(): boolean {
  const envMode = process.env[ENV_INSTANCE_MODE];
  return envMode === "master" || envMode === "slave" || envMode === "standalone";
}

/**
 * Checks if sync token is configured via environment variable.
 */
export function isSyncTokenFromEnv(): boolean {
  const envToken = process.env[ENV_INSTANCE_SYNC_TOKEN];
  return typeof envToken === "string" && envToken.length > 0;
}

export async function getInstanceMode(): Promise<InstanceMode> {
  // Environment variable takes precedence
  const envMode = process.env[ENV_INSTANCE_MODE];
  if (envMode === "master" || envMode === "slave" || envMode === "standalone") {
    return envMode;
  }

  // Fall back to database setting
  const stored = await getSetting<string>(INSTANCE_MODE_KEY);
  if (stored === "master" || stored === "slave" || stored === "standalone") {
    return stored;
  }
  return "standalone";
}

export async function setInstanceMode(mode: InstanceMode): Promise<void> {
  // If mode is set via environment, don't allow changing it
  if (isInstanceModeFromEnv()) {
    console.warn("Instance mode is configured via INSTANCE_MODE environment variable and cannot be changed at runtime");
    return;
  }
  await setSetting(INSTANCE_MODE_KEY, mode);
}

export async function getSlaveMasterToken(): Promise<string | null> {
  // Environment variable takes precedence
  const envToken = process.env[ENV_INSTANCE_SYNC_TOKEN];
  if (typeof envToken === "string" && envToken.length > 0) {
    return envToken;
  }

  // Fall back to database setting
  const stored = await getSetting<string>(MASTER_TOKEN_KEY);
  if (!stored) {
    return null;
  }
  if (!isEncryptedSecret(stored)) {
    try {
      await setSetting(MASTER_TOKEN_KEY, encryptSecret(stored));
    } catch (error) {
      console.warn("Failed to encrypt stored master token:", error);
    }
    return stored;
  }
  try {
    return decryptSecret(stored);
  } catch (error) {
    console.error("Failed to decrypt stored master token:", error);
    return null;
  }
}

export async function setSlaveMasterToken(token: string | null): Promise<void> {
  // If token is set via environment, don't allow changing it
  if (isSyncTokenFromEnv()) {
    console.warn("Sync token is configured via INSTANCE_SYNC_TOKEN environment variable and cannot be changed at runtime");
    return;
  }
  const next = token ? encryptSecret(token) : "";
  await setSetting(MASTER_TOKEN_KEY, next);
}

export async function getSlaveLastSync(): Promise<{ at: string | null; error: string | null }> {
  const [at, error] = await Promise.all([
    getSetting<string>(SLAVE_LAST_SYNC_AT_KEY),
    getSetting<string>(SLAVE_LAST_SYNC_ERROR_KEY)
  ]);

  return {
    at: at ?? null,
    error: error && error.length > 0 ? error : null
  };
}

export async function setSlaveLastSync(result: { ok: boolean; error?: string | null }) {
  await setSetting(SLAVE_LAST_SYNC_AT_KEY, nowIso());
  await setSetting(SLAVE_LAST_SYNC_ERROR_KEY, result.ok ? "" : result.error ?? "Unknown sync error");
}

export async function getSyncedSetting<T>(key: string): Promise<T | null> {
  return await getSetting<T>(`${SYNCED_PREFIX}${key}`);
}

export async function setSyncedSetting<T>(key: string, value: T | null): Promise<void> {
  await setSetting(`${SYNCED_PREFIX}${key}`, value ?? null);
}

export async function clearSyncedSetting(key: string): Promise<void> {
  await setSetting(`${SYNCED_PREFIX}${key}`, null);
}

export async function buildSyncPayload(): Promise<SyncPayload> {
  const [certRows, accessListRows, accessEntryRows, proxyRows, redirectRows, deadRows] = await Promise.all([
    db.select().from(certificates),
    db.select().from(accessLists),
    db.select().from(accessListEntries),
    db.select().from(proxyHosts),
    db.select().from(redirectHosts),
    db.select().from(deadHosts)
  ]);

  const settings = {
    general: await getSetting("general"),
    cloudflare: await getSetting("cloudflare"),
    authentik: await getSetting("authentik"),
    metrics: await getSetting("metrics"),
    logging: await getSetting("logging"),
    dns: await getSetting("dns")
  };

  const sanitizedAccessLists = accessListRows.map((row) => ({
    ...row,
    createdBy: null
  }));

  const sanitizedCertificates = certRows.map((row) => ({
    ...row,
    createdBy: null
  }));

  const sanitizedRedirects = redirectRows.map((row) => ({
    ...row,
    createdBy: null
  }));

  const sanitizedDeadHosts = deadRows.map((row) => ({
    ...row,
    createdBy: null
  }));

  const sanitizedProxyHosts = proxyRows.map((row) => ({
    ...row,
    ownerUserId: null
  }));

  return {
    generated_at: nowIso(),
    settings,
    data: {
      certificates: sanitizedCertificates,
      accessLists: sanitizedAccessLists,
      accessListEntries: accessEntryRows,
      proxyHosts: sanitizedProxyHosts,
      redirectHosts: sanitizedRedirects,
      deadHosts: sanitizedDeadHosts
    }
  };
}

export async function syncInstances(): Promise<{ total: number; success: number; failed: number; skippedHttp: number }> {
  const mode = await getInstanceMode();
  if (mode !== "master") {
    return { total: 0, success: 0, failed: 0, skippedHttp: 0 };
  }

  // Get database-configured instances
  const dbTargets = await db.query.instances.findMany({
    where: (table, operators) => operators.eq(table.enabled, true)
  });

  // Get environment-configured instances
  const envTargets = getEnvSlaveInstances();

  if (dbTargets.length === 0 && envTargets.length === 0) {
    return { total: 0, success: 0, failed: 0, skippedHttp: 0 };
  }

  const httpAllowed = isHttpSyncAllowed();
  const payload = await buildSyncPayload();
  let skippedHttp = 0;

  // Sync database-configured instances
  const dbResults = await Promise.all(
    dbTargets.map(async (instance) => {
      if (!isEncryptedSecret(instance.apiToken)) {
        try {
          await updateInstance(instance.id, { apiToken: instance.apiToken });
        } catch (error) {
          console.warn(`Failed to encrypt stored token for instance "${instance.name}":`, error);
        }
      }

      let token: string;
      try {
        token = decryptSecret(instance.apiToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordInstanceSyncResult(instance.id, { ok: false, error: `Token decrypt failed: ${message}` });
        return { ok: false, skippedHttp: false };
      }

      // Check for HTTP URL
      if (isHttpUrl(instance.baseUrl) && !httpAllowed) {
        const message = "HTTP sync blocked. Set INSTANCE_SYNC_ALLOW_HTTP=true to allow insecure sync.";
        console.warn(`Skipping sync to "${instance.name}": ${message}`);
        await recordInstanceSyncResult(instance.id, { ok: false, error: message });
        return { ok: false, skippedHttp: true };
      }

      try {
        const response = await fetch(`${instance.baseUrl.replace(/\/$/, "")}/api/instances/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Sync failed: ${response.status} ${text}`);
        }

        await recordInstanceSyncResult(instance.id, { ok: true });
        return { ok: true, skippedHttp: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordInstanceSyncResult(instance.id, { ok: false, error: message });
        return { ok: false, skippedHttp: false };
      }
    })
  );

  // Sync environment-configured instances
  const envResults = await Promise.all(
    envTargets.map(async (instance) => {
      // Check for HTTP URL
      if (isHttpUrl(instance.url) && !httpAllowed) {
        console.warn(`Skipping sync to env-configured instance "${instance.name}": HTTP sync blocked. Set INSTANCE_SYNC_ALLOW_HTTP=true to allow insecure sync.`);
        return { ok: false, skippedHttp: true };
      }

      try {
        const response = await fetch(`${instance.url.replace(/\/$/, "")}/api/instances/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${instance.token}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Sync failed: ${response.status} ${text}`);
        }

        console.log(`Sync to env-configured instance "${instance.name}" succeeded`);
        return { ok: true, skippedHttp: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Sync to env-configured instance "${instance.name}" failed:`, message);
        return { ok: false, skippedHttp: false };
      }
    })
  );

  const allResults = [...dbResults, ...envResults];
  const success = allResults.filter((r) => r.ok).length;
  skippedHttp = allResults.filter((r) => r.skippedHttp).length;
  const failed = allResults.length - success - skippedHttp;

  return { total: allResults.length, success, failed, skippedHttp };
}

export async function applySyncPayload(payload: SyncPayload) {
  await setSyncedSetting("general", payload.settings.general);
  await setSyncedSetting("cloudflare", payload.settings.cloudflare);
  await setSyncedSetting("authentik", payload.settings.authentik);
  await setSyncedSetting("metrics", payload.settings.metrics);
  await setSyncedSetting("logging", payload.settings.logging);
  await setSyncedSetting("dns", payload.settings.dns);

  // better-sqlite3 is synchronous, so transaction callback must be synchronous
  db.transaction((tx) => {
    tx.delete(proxyHosts).run();
    tx.delete(redirectHosts).run();
    tx.delete(deadHosts).run();
    tx.delete(accessListEntries).run();
    tx.delete(accessLists).run();
    tx.delete(certificates).run();

    if (payload.data.certificates.length > 0) {
      tx.insert(certificates).values(payload.data.certificates).run();
    }
    if (payload.data.accessLists.length > 0) {
      tx.insert(accessLists).values(payload.data.accessLists).run();
    }
    if (payload.data.accessListEntries.length > 0) {
      tx.insert(accessListEntries).values(payload.data.accessListEntries).run();
    }
    if (payload.data.proxyHosts.length > 0) {
      tx.insert(proxyHosts).values(payload.data.proxyHosts).run();
    }
    if (payload.data.redirectHosts.length > 0) {
      tx.insert(redirectHosts).values(payload.data.redirectHosts).run();
    }
    if (payload.data.deadHosts.length > 0) {
      tx.insert(deadHosts).values(payload.data.deadHosts).run();
    }
  });
}
