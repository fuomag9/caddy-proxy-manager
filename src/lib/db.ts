import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, ne, and, isNull, desc } from "drizzle-orm";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import * as schema from "./db/schema";
import {
  CREDENTIAL_ACCOUNT_ISSUER,
  resolveOAuthAccountIssuer,
} from "./account-issuer";

const DEFAULT_SQLITE_URL = "file:./data/caddy-proxy-manager.db";

type GlobalForDrizzle = typeof globalThis & {
  __DRIZZLE_DB__?: ReturnType<typeof drizzle<typeof schema>>;
  __SQLITE_CLIENT__?: InstanceType<typeof Database>;
  __MIGRATIONS_RAN__?: boolean;
};

function resolveSqlitePath(rawUrl: string): string {
  if (!rawUrl) {
    return ":memory:";
  }
  if (rawUrl === ":memory:" || rawUrl === "file::memory:") {
    return ":memory:";
  }

  if (rawUrl.startsWith("file:./") || rawUrl.startsWith("file:../")) {
    const relative = rawUrl.slice("file:".length);
    return resolvePath(/* turbopackIgnore: true */ process.cwd(), relative);
  }

  if (rawUrl.startsWith("file:")) {
    try {
      const fileUrl = new URL(rawUrl);
      if (fileUrl.host && fileUrl.host !== "localhost") {
        throw new Error("Remote SQLite hosts are not supported.");
      }
      return decodeURIComponent(fileUrl.pathname);
    } catch {
      const remainder = rawUrl.slice("file:".length);
      if (!remainder) {
        return ":memory:";
      }
      return isAbsolute(remainder)
        ? remainder
        : resolvePath(/* turbopackIgnore: true */ process.cwd(), remainder);
    }
  }

  return isAbsolute(rawUrl)
    ? rawUrl
    : resolvePath(/* turbopackIgnore: true */ process.cwd(), rawUrl);
}

const databaseUrl = process.env.DATABASE_URL ?? DEFAULT_SQLITE_URL;
const sqlitePath = resolveSqlitePath(databaseUrl);

function ensureDirectoryFor(pathname: string) {
  if (pathname === ":memory:") {
    return;
  }
  const dir = dirname(pathname);
  mkdirSync(dir, { recursive: true });
}

/**
 * The database holds password hashes, session tokens and encrypted secrets,
 * but SQLite creates its files with the process umask (usually world-readable).
 * Remove world access from the database and its journal files. Owner and group
 * bits are kept, so group-based access (e.g. a backup job) keeps working.
 */
export function restrictDatabaseFileModes(pathname: string = sqlitePath): void {
  if (pathname === ":memory:") return;
  for (const file of [pathname, `${pathname}-journal`, `${pathname}-wal`, `${pathname}-shm`]) {
    try {
      if (!existsSync(file)) continue;
      const mode = statSync(file).mode & 0o7777;
      if (mode & 0o007) chmodSync(file, mode & ~0o007);
    } catch (error) {
      console.warn(`Could not restrict permissions on ${file}:`, (error as NodeJS.ErrnoException).code ?? error);
    }
  }
}

const globalForDrizzle = globalThis as GlobalForDrizzle;

export const sqlite =
  globalForDrizzle.__SQLITE_CLIENT__ ??
  (() => {
    ensureDirectoryFor(sqlitePath);
    const client = new Database(sqlitePath);
    restrictDatabaseFileModes(sqlitePath);
    return client;
  })();

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__SQLITE_CLIENT__ = sqlite;
}

export const db =
  globalForDrizzle.__DRIZZLE_DB__ ?? drizzle(sqlite, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDrizzle.__DRIZZLE_DB__ = db;
}

const migrationsFolder = resolvePath(process.cwd(), "drizzle");

/**
 * Rename a column if the snake_case form exists and the camelCase form does not.
 * No-ops silently if the table doesn't exist or the column is already correct.
 */
function renameColumnIfNeeded(table: string, from: string, to: string) {
  try {
    const cols = db.$client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (names.has(from) && !names.has(to)) {
      db.$client.prepare(`ALTER TABLE "${table}" RENAME COLUMN "${from}" TO "${to}"`).run();
    }
  } catch {
    // ignore
  }
}

/**
 * Add a column if it is absent from the table (checks both snake_case and camelCase
 * forms so we don't add a column that was already renamed by a later migration).
 */
function addColumnIfMissing(table: string, snake: string, camel: string, definition: string) {
  try {
    const cols = db.$client.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
    if (cols.length === 0) return; // table doesn't exist yet
    const names = new Set(cols.map((c) => c.name));
    if (!names.has(snake) && !names.has(camel)) {
      db.$client.prepare(`ALTER TABLE "${table}" ADD COLUMN "${snake}" ${definition}`).run();
    }
  } catch {
    // ignore
  }
}

/**
 * Ensure the sessions table uses INTEGER PRIMARY KEY AUTOINCREMENT for `id`.
 * Better Auth is configured with generateId:"serial" so it omits `id` from INSERT
 * and relies on the DB to generate it. If the table was created with `id TEXT NOT NULL`
 * (older schema), the insert fails with NOT NULL constraint. Sessions are ephemeral
 * so we simply recreate the table with the correct schema when needed.
 */
function fixSessionsSchema() {
  try {
    const cols = db.$client.prepare('PRAGMA table_info("sessions")').all() as Array<{
      name: string; type: string; pk: number;
    }>;
    if (cols.length === 0) return; // table doesn't exist yet
    const idCol = cols.find((c) => c.name === "id");
    if (!idCol) return;
    // INTEGER PRIMARY KEY is an alias for rowid — auto-generates on insert
    if (idCol.type.toUpperCase() === "INTEGER" && idCol.pk === 1) return;
    // Wrong type (e.g. TEXT NOT NULL) — recreate as autoincrement
    db.$client.prepare(`CREATE TABLE "sessions_patch" (
      "id"        INTEGER PRIMARY KEY AUTOINCREMENT,
      "userId"    INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token"     TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )`).run();
    // Sessions are short-lived — skip copying stale rows
    db.$client.prepare('DROP TABLE "sessions"').run();
    db.$client.prepare('ALTER TABLE "sessions_patch" RENAME TO "sessions"').run();
    db.$client.prepare('CREATE UNIQUE INDEX IF NOT EXISTS "sessions_token_unique" ON "sessions" ("token")').run();
    db.$client.prepare('CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" ("userId")').run();
  } catch {
    // ignore
  }
}

/**
 * Ensure the accounts table uses INTEGER PRIMARY KEY AUTOINCREMENT for `id`.
 * Some upgraded deployments can end up with an `accounts.id` column that is
 * NOT NULL but not rowid-backed, so inserts that omit `id` fail. Unlike
 * sessions, accounts are durable, so preserve rows while rebuilding the table.
 */
function fixAccountsSchema() {
  try {
    const cols = db.$client.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string; type: string; notnull: number; pk: number; dflt_value: string | null;
    }>;
    if (cols.length === 0) return;
    const idCol = cols.find((c) => c.name === 'id');
    if (!idCol) return;
    const issuerCol = cols.find((c) => c.name === "issuer");
    const indexes = db.$client.prepare('PRAGMA index_list("accounts")').all() as Array<{
      name: string;
      unique: number;
    }>;
    const issuerIndex = indexes.find(
      (index) => index.name === "accounts_issuer_account_idx" && index.unique === 1
    );
    const issuerIndexColumns = issuerIndex
      ? db.$client.prepare('PRAGMA index_info("accounts_issuer_account_idx")').all() as Array<{
          name: string;
          seqno: number;
        }>
      : [];
    const hasCorrectIssuerIndex = issuerIndexColumns
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name)
      .join(",") === "issuer,accountId";
    const hasLegacyProviderIndex = indexes.some(
      (index) => index.name === "accounts_provider_account_idx"
    );
    const idIsCorrect = idCol.type.toUpperCase() === "INTEGER" && idCol.pk === 1;
    // "Correct" means a shape Better Auth accepts. Since Better Auth 1.7.3+ the
    // runtime schema validation fails closed on NOT NULL columns it never
    // writes unless they carry a database default (issue #283) — so the
    // CPM-only `issuer` column must be NOT NULL *with* a default, not merely
    // NOT NULL. Deployments upgraded from ≤ v1.11.2 carry the pre-0025 shape
    // and are rebuilt here at boot, before Better Auth's check runs.
    const issuerIsCorrect = issuerCol?.notnull === 1 && issuerCol?.dflt_value != null;

    if (idIsCorrect && issuerIsCorrect && hasCorrectIssuerIndex && !hasLegacyProviderIndex) {
      return;
    }

    type LegacyAccountRow = {
      id: number | string;
      userId: number;
      issuer?: string | null;
      accountId: string;
      providerId: string;
      accessToken: string | null;
      refreshToken: string | null;
      idToken: string | null;
      accessTokenExpiresAt: string | null;
      refreshTokenExpiresAt: string | null;
      scope: string | null;
      password: string | null;
      createdAt: string;
      updatedAt: string;
    };

    const accountRows = db.$client
      .prepare('SELECT * FROM "accounts" ORDER BY "id"')
      .all() as LegacyAccountRow[];
    const providerIssuers = new Map<string, string | null>();
    const hasProviderTable = db.$client
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'oauth_providers'")
      .get();
    if (hasProviderTable) {
      const providers = db.$client
        .prepare('SELECT "id", "issuer" FROM "oauth_providers"')
        .all() as Array<{ id: string; issuer: string | null }>;
      for (const provider of providers) {
        providerIssuers.set(provider.id, provider.issuer);
      }
    }

    const normalizedRows = accountRows.map((row) => {
      const existingIssuer = row.issuer?.trim();
      const issuer = existingIssuer || (
        row.providerId === "credential"
          ? CREDENTIAL_ACCOUNT_ISSUER
          : resolveOAuthAccountIssuer(row.providerId, providerIssuers.get(row.providerId))
      );
      return { ...row, issuer };
    });

    // Better Auth 1.7 keys external identities by (issuer, accountId). Never
    // merge a collision implicitly: two legacy rows may belong to different
    // users, and choosing either one could turn a migration into account takeover.
    const identityOwners = new Map<string, number | string>();
    for (const row of normalizedRows) {
      const key = JSON.stringify([row.issuer, row.accountId]);
      const existingOwner = identityOwners.get(key);
      if (existingOwner !== undefined) {
        throw new Error(
          `account identity collision for issuer "${row.issuer}" and accountId "${row.accountId}"`
        );
      }
      identityOwners.set(key, row.id);
    }

    const repair = db.$client.transaction(() => {
      db.$client.prepare('DROP TABLE IF EXISTS "accounts_patch"').run();
      db.$client.prepare(`CREATE TABLE "accounts_patch" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "issuer" TEXT NOT NULL DEFAULT '',
        "accountId" TEXT NOT NULL,
        "providerId" TEXT NOT NULL,
        "accessToken" TEXT,
        "refreshToken" TEXT,
        "idToken" TEXT,
        "accessTokenExpiresAt" TEXT,
        "refreshTokenExpiresAt" TEXT,
        "scope" TEXT,
        "password" TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )`).run();
      const insert = db.$client.prepare(`INSERT INTO "accounts_patch" (
        "id", "userId", "issuer", "accountId", "providerId", "accessToken", "refreshToken", "idToken",
        "accessTokenExpiresAt", "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of normalizedRows) {
        insert.run(
          row.id,
          row.userId,
          row.issuer,
          row.accountId,
          row.providerId,
          row.accessToken,
          row.refreshToken,
          row.idToken,
          row.accessTokenExpiresAt,
          row.refreshTokenExpiresAt,
          row.scope,
          row.password,
          row.createdAt,
          row.updatedAt
        );
      }
      db.$client.prepare('DROP TABLE "accounts"').run();
      db.$client.prepare('ALTER TABLE "accounts_patch" RENAME TO "accounts"').run();
      db.$client.prepare(
        'CREATE UNIQUE INDEX "accounts_issuer_account_idx" ON "accounts" ("issuer", "accountId")'
      ).run();
      db.$client.prepare(
        'CREATE INDEX "accounts_user_idx" ON "accounts" ("userId")'
      ).run();
    });
    repair();
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    const code = (error as { code?: string } | null)?.code;
    if (code === "SQLITE_READONLY" || code === "SQLITE_READONLY_DBMOVED" || /readonly/i.test(detail)) {
      // The repair is the first write of the boot sequence, so an unwritable
      // database file surfaces here first. Callers hitting this after a
      // `docker cp` round-trip saw a bare driver error with no hint (issue
      // #283) — name the likely cause and the fix.
      throw new Error(
        `Failed to repair Better Auth accounts schema: ${detail}. ` +
          "The SQLite database file is not writable by the application user " +
          "(uid 10001 in the published image). Check ownership and permissions " +
          "of the database file and its parent directory on the host volume " +
          "(for example after a `docker cp`, run: chown 10001:10001 <file>).",
        { cause: error }
      );
    }
    throw new Error(`Failed to repair Better Auth accounts schema: ${detail}`, {
      cause: error,
    });
  }
}

/**
 * Pre-migration compatibility patch for deployments that ran an older version of
 * migration 0020 with different column names. Migration 0021 renames columns in
 * many tables but does NOT touch `accounts`, `sessions`, or `verifications` — if
 * those were created with snake_case names they stay that way and Better Auth fails.
 *
 * This function runs before `migrate()` and brings any stale table schemas up to
 * the state that 0021/0022 expect, so the Drizzle migrations can complete cleanly.
 */
function patchTablesForMigration020() {
  // ── users ────────────────────────────────────────────────────────────────────
  // Columns added by 0020 that older deployments may be missing
  addColumnIfMissing("users", "email_verified", "emailVerified", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("users", "username",        "username",      "TEXT");
  addColumnIfMissing("users", "display_username", "displayUsername", "TEXT");

  // ── accounts ─────────────────────────────────────────────────────────────────
  // 0020 should create these with camelCase; older versions used snake_case.
  // 0021 does NOT rename accounts columns, so we must fix them here.
  renameColumnIfNeeded("accounts", "user_id",                  "userId");
  renameColumnIfNeeded("accounts", "account_id",               "accountId");
  renameColumnIfNeeded("accounts", "provider_id",              "providerId");
  renameColumnIfNeeded("accounts", "access_token",             "accessToken");
  renameColumnIfNeeded("accounts", "refresh_token",            "refreshToken");
  renameColumnIfNeeded("accounts", "id_token",                 "idToken");
  renameColumnIfNeeded("accounts", "access_token_expires_at",  "accessTokenExpiresAt");
  renameColumnIfNeeded("accounts", "refresh_token_expires_at", "refreshTokenExpiresAt");
  renameColumnIfNeeded("accounts", "created_at",               "createdAt");
  renameColumnIfNeeded("accounts", "updated_at",               "updatedAt");
  fixAccountsSchema();

  // ── sessions ─────────────────────────────────────────────────────────────────
  // auth-server.ts uses generateId:"serial" — Better Auth omits `id` from INSERT
  // and relies on INTEGER PRIMARY KEY AUTOINCREMENT. If the cloud's older schema
  // had `id TEXT NOT NULL`, the insert fails. Recreate the table when needed.
  // Sessions are ephemeral so data loss is acceptable.
  fixSessionsSchema();
  renameColumnIfNeeded("sessions", "user_id",    "userId");
  renameColumnIfNeeded("sessions", "expires_at", "expiresAt");
  renameColumnIfNeeded("sessions", "ip_address", "ipAddress");
  renameColumnIfNeeded("sessions", "user_agent", "userAgent");
  renameColumnIfNeeded("sessions", "created_at", "createdAt");
  renameColumnIfNeeded("sessions", "updated_at", "updatedAt");

  // ── verifications ─────────────────────────────────────────────────────────────
  renameColumnIfNeeded("verifications", "expires_at", "expiresAt");
  renameColumnIfNeeded("verifications", "created_at", "createdAt");
  renameColumnIfNeeded("verifications", "updated_at", "updatedAt");
}

function runMigrations() {
  if (sqlitePath === ":memory:") {
    return;
  }
  if (globalForDrizzle.__MIGRATIONS_RAN__) {
    return;
  }
  patchTablesForMigration020();
  try {
    migrate(db, { migrationsFolder });
    globalForDrizzle.__MIGRATIONS_RAN__ = true;
  } catch (error: unknown) {
    // During build, pages may be pre-rendered in parallel, causing race conditions
    // with migrations. If tables already exist, just continue.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error &&
      error.code === "SQLITE_ERROR" &&
      typeof error.message === "string" &&
      error.message.includes("already exists")
    ) {
      console.log('Database tables already exist, skipping migrations');
      globalForDrizzle.__MIGRATIONS_RAN__ = true;
      return;
    }
    throw error;
  }
}

try {
  runMigrations();
} catch (error) {
  console.error("Failed to run database migrations:", error);
  // Next's production build can import this module from parallel workers that
  // share the temporary build database. Runtime, development, and tests must
  // fail closed on migration errors so identity collisions are never ignored.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.warn('Continuing despite migration error during build phase');
  } else {
    throw error;
  }
}

/**
 * One-time migration: populate `accounts` table from existing users' provider/subject fields.
 * Also creates credential accounts for password users and syncs env OAuth providers.
 * Idempotent — skips if already run (checked via settings flag).
 */
function runBetterAuthDataMigration() {
  if (sqlitePath === ":memory:") return;

  const { settings, users, accounts, oauthProviders } = schema;

  const flag = db.select().from(settings).where(eq(settings.key, "better_auth_migrated")).get();
  if (flag) return;

  const now = new Date().toISOString();

  // Migrate OAuth users: create account rows from users.provider/subject
  const oauthUsers = db.select().from(users).where(ne(users.provider, "credentials")).all();
  for (const user of oauthUsers) {
    if (!user.provider || !user.subject) continue;
    const existing = db.select().from(accounts).where(
      and(eq(accounts.userId, user.id), eq(accounts.providerId, user.provider), eq(accounts.accountId, user.subject))
    ).get();
    if (!existing) {
      const configuredProvider = db.select({ issuer: oauthProviders.issuer })
        .from(oauthProviders)
        .where(eq(oauthProviders.id, user.provider))
        .get();
      db.insert(accounts).values({
        userId: user.id,
        issuer: resolveOAuthAccountIssuer(user.provider, configuredProvider?.issuer),
        accountId: user.subject,
        providerId: user.provider,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }).run();
    }
  }

  // Migrate credentials users: create credential account rows
  const credentialUsers = db.select().from(users).where(eq(users.provider, "credentials")).all();
  for (const user of credentialUsers) {
    const existing = db.select().from(accounts).where(
      and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential"))
    ).get();
    if (!existing) {
      db.insert(accounts).values({
        userId: user.id,
        issuer: CREDENTIAL_ACCOUNT_ISSUER,
        accountId: user.id.toString(),
        providerId: "credential",
        password: user.passwordHash,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }).run();
    }
  }

  // Populate username field for all users (derived from email prefix)
  const usersWithoutUsername = db.select().from(users).where(isNull(users.username)).all();
  for (const user of usersWithoutUsername) {
    const usernameFromEmail = user.email.toLowerCase();
    const displayUsername = user.email.split("@")[0] || user.email;
    db.update(users).set({
      username: usernameFromEmail,
      displayUsername,
    }).where(eq(users.id, user.id)).run();
  }

  db.insert(settings).values({ key: "better_auth_migrated", value: "true", updatedAt: now }).run();
  console.log("Better Auth data migration complete: populated accounts table");
}

/**
 * Sync OAUTH_* env vars into the oauthProviders table (synchronous).
 * Uses raw Drizzle queries since this runs at module load time.
 */
function runEnvProviderSync() {
  if (sqlitePath === ":memory:") return;

  // Lazy import to avoid circular dependency at module load
  let config: { oauth: { enabled: boolean; providerName: string; clientId: string | null; clientSecret: string | null; issuer: string | null; authorizationUrl: string | null; tokenUrl: string | null; userinfoUrl: string | null; allowAutoLinking: boolean } };
  try {
    config = require("./config").config; // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    return;
  }

  if (!config.oauth.enabled || !config.oauth.clientId || !config.oauth.clientSecret) return;

  const { oauthProviders } = schema;
  let encryptSecret: (v: string) => string;
  try {
    encryptSecret = require("./secret").encryptSecret; // eslint-disable-line @typescript-eslint/no-require-imports
  } catch (e) {
    console.error("CRITICAL: Failed to load encryption module, refusing to store plaintext secrets:", e);
    return;
  }

  const name = config.oauth.providerName;
  // Use a slug-based ID so the OAuth callback URL is predictable
  const providerId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "oauth";
  const existing = db.select().from(oauthProviders).where(eq(oauthProviders.name, name)).get();

  const now = new Date().toISOString();
  if (existing && existing.source === "env") {
    db.update(oauthProviders).set({
      clientId: encryptSecret(config.oauth.clientId),
      clientSecret: encryptSecret(config.oauth.clientSecret),
      issuer: config.oauth.issuer ?? null,
      authorizationUrl: config.oauth.authorizationUrl ?? null,
      tokenUrl: config.oauth.tokenUrl ?? null,
      userinfoUrl: config.oauth.userinfoUrl ?? null,
      autoLink: config.oauth.allowAutoLinking,
      updatedAt: now,
    }).where(eq(oauthProviders.id, existing.id)).run();
  } else if (!existing) {
    db.insert(oauthProviders).values({
      id: providerId,
      name,
      type: "oidc",
      clientId: encryptSecret(config.oauth.clientId),
      clientSecret: encryptSecret(config.oauth.clientSecret),
      issuer: config.oauth.issuer ?? null,
      authorizationUrl: config.oauth.authorizationUrl ?? null,
      tokenUrl: config.oauth.tokenUrl ?? null,
      userinfoUrl: config.oauth.userinfoUrl ?? null,
      scopes: "openid email profile",
      autoLink: config.oauth.allowAutoLinking,
      enabled: true,
      source: "env",
      createdAt: now,
      updatedAt: now,
    }).run();
    console.log(`Synced OAuth provider from env: ${name}`);
  }
}

/**
 * One-time migration: convert legacy Cloudflare DNS settings to the new
 * generic dns_provider format.  Idempotent — skips if already run or if
 * the new setting already exists.
 */
function runCloudflareToProviderMigration() {
  if (sqlitePath === ":memory:") return;

  const { settings: settingsTable } = schema;

  // Skip if migration already ran
  const flag = db.select().from(settingsTable).where(eq(settingsTable.key, "dns_provider_migrated")).get();
  if (flag) return;

  // Skip if new dns_provider setting already exists (user already configured it)
  const existing = db.select().from(settingsTable).where(eq(settingsTable.key, "dns_provider")).get();
  if (existing) {
    const now = new Date().toISOString();
    db.insert(settingsTable).values({ key: "dns_provider_migrated", value: "true", updatedAt: now }).run();
    return;
  }

  // Check for legacy cloudflare setting
  const cfRow = db.select().from(settingsTable).where(eq(settingsTable.key, "cloudflare")).get();
  if (!cfRow) {
    const now = new Date().toISOString();
    db.insert(settingsTable).values({ key: "dns_provider_migrated", value: "true", updatedAt: now }).run();
    return;
  }

  try {
    const cf = JSON.parse(cfRow.value) as { apiToken?: string; zoneId?: string; accountId?: string };
    if (cf.apiToken) {
      const now = new Date().toISOString();
      const newSetting = {
        providers: { cloudflare: { api_token: cf.apiToken } },
        default: "cloudflare",
      };
      db.insert(settingsTable).values({ key: "dns_provider", value: JSON.stringify(newSetting), updatedAt: now }).run();
      console.log("Migrated legacy Cloudflare DNS settings to dns_provider format");
    }
  } catch (e) {
    console.warn("Failed to parse legacy cloudflare setting during migration:", e);
  }

  const now = new Date().toISOString();
  db.insert(settingsTable).values({ key: "dns_provider_migrated", value: "true", updatedAt: now }).run();
}

/**
 * One-time repair (#261): re-derive `users.provider` / `users.subject` from the
 * authoritative `accounts` table. Deployments that linked or unlinked OAuth
 * identities before the sync hook existed carry stale values, which made the
 * Profile page report the wrong connection state.
 */
function runOAuthIdentityRepair() {
  if (sqlitePath === ":memory:") return;

  const flag = db.select().from(schema.settings).where(eq(schema.settings.key, "oauth_identity_sync_repaired")).get();
  if (flag) return;

  const allUsers = db.select({ id: schema.users.id }).from(schema.users).all();
  for (const user of allUsers) {
    const [oauthAccount] = db
      .select({ providerId: schema.accounts.providerId, accountId: schema.accounts.accountId })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, user.id), ne(schema.accounts.providerId, "credential")))
      .orderBy(desc(schema.accounts.id))
      .limit(1)
      .all();

    if (oauthAccount) {
      db.update(schema.users)
        .set({ provider: oauthAccount.providerId, subject: oauthAccount.accountId, updatedAt: new Date().toISOString() })
        .where(eq(schema.users.id, user.id))
        .run();
      continue;
    }

    const credentialAccount = db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, user.id), eq(schema.accounts.providerId, "credential")))
      .get();
    const row = db.select({ passwordHash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id)).get();
    const hasCredential = !!credentialAccount || !!row?.passwordHash;
    db.update(schema.users)
      .set({ provider: hasCredential ? "credentials" : null, subject: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, user.id))
      .run();
  }

  db.insert(schema.settings).values({ key: "oauth_identity_sync_repaired", value: "true", updatedAt: new Date().toISOString() }).run();
  console.log("OAuth identity repair complete: users.provider/subject re-derived from accounts");
}

try {
  runBetterAuthDataMigration();
  runEnvProviderSync();
  runCloudflareToProviderMigration();
  runOAuthIdentityRepair();
} catch (error) {
  console.warn("Better Auth data migration warning:", error);
}

export { schema };
export default db;

export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
