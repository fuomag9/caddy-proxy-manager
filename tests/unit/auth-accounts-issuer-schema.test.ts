/**
 * Regression #283: Better Auth 1.7.3+ performs runtime schema validation and
 * fails closed on any NOT NULL column it never writes unless that column is
 * nullable or carries a database default. CPM keeps its own NOT NULL
 * `accounts.issuer` column for identity bookkeeping while Better Auth 1.7.4 no
 * longer writes it, so the column must carry a database default — otherwise
 * every login (local and OAuth) dies with SCHEMA_MISMATCH before any insert is
 * even attempted.
 *
 * Unlike the rest of the unit suite, these tests do NOT mock better-auth (that
 * stubbing is exactly how this regression slipped past CI) and do NOT mock the
 * db module. They boot the real db module (migrations + fixAccountsSchema) and
 * the real auth-server against a file-backed SQLite database:
 *
 *   1. fresh install — migrations give `issuer` a default, Better Auth's
 *      schema check passes, and sign-up/sign-in work end to end;
 *   2. upgraded database — a table still carrying the pre-0025
 *      `issuer TEXT NOT NULL` shape (anything provisioned by ≤ v1.11.2) is
 *      repaired at boot by fixAccountsSchema() and existing accounts survive;
 *   3. unwritable database — when the SQLite file is not writable by the app
 *      user (e.g. root-owned after a `docker cp`), the boot repair fails with
 *      an actionable message instead of a bare driver error.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';

const workDir = mkdtempSync(join(tmpdir(), 'cpm-283-'));

// Vitest leaks Vite's import.meta.env into process.env (BASE_URL='/'), which
// better-auth rejects — pin what production would have.
const APP_BASE_URL = 'http://localhost:3000';

let dbPath = '';

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

const globalForDb = globalThis as {
  __SQLITE_CLIENT__?: { close: () => void };
  __DRIZZLE_DB__?: unknown;
  __MIGRATIONS_RAN__?: boolean;
};

function resetDbModule(dbFile: string, env: Record<string, string | undefined> = {}) {
  dbPath = join(workDir, dbFile);
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.BASE_URL = APP_BASE_URL;
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalForDb.__SQLITE_CLIENT__?.close();
  delete globalForDb.__SQLITE_CLIENT__;
  delete globalForDb.__DRIZZLE_DB__;
  delete globalForDb.__MIGRATIONS_RAN__;
  vi.resetModules();
}

afterAll(() => {
  globalForDb.__SQLITE_CLIENT__?.close();
  if (dbPath) chmodSync(dbPath, 0o644);
  rmSync(workDir, { recursive: true, force: true });
  process.env.DATABASE_URL = ':memory:';
  delete process.env.AUTH_ALLOW_SELF_REGISTRATION;
  delete globalForDb.__SQLITE_CLIENT__;
  delete globalForDb.__DRIZZLE_DB__;
  delete globalForDb.__MIGRATIONS_RAN__;
  vi.resetModules();
});

/** The physical `accounts.issuer` column after boot. */
function issuerColumn() {
  const raw = new Database(dbPath);
  try {
    const cols = raw.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string; notnull: number; dflt_value: string | null;
    }>;
    const col = cols.find((c) => c.name === 'issuer');
    expect(col).toBeDefined();
    return col as { name: string; notnull: number; dflt_value: string | null };
  } finally {
    raw.close();
  }
}

/** Rewinds `accounts` to the pre-0025 shape Better Auth 1.7.4 rejects (≤ v1.11.2). */
function regressToLegacyAccountsShape() {
  const raw = new Database(dbPath);
  try {
    raw.exec(`
      CREATE TABLE "accounts_legacy" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "issuer" TEXT NOT NULL,
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
      );
      INSERT INTO "accounts_legacy"
        SELECT "id", "userId", "issuer", "accountId", "providerId", "accessToken",
               "refreshToken", "idToken", "accessTokenExpiresAt",
               "refreshTokenExpiresAt", "scope", "password", "createdAt", "updatedAt"
        FROM "accounts";
      DROP TABLE "accounts";
      ALTER TABLE "accounts_legacy" RENAME TO "accounts";
      CREATE UNIQUE INDEX "accounts_issuer_account_idx" ON "accounts" ("issuer", "accountId");
      CREATE INDEX "accounts_user_idx" ON "accounts" ("userId");
    `);
    const cols = raw.prepare('PRAGMA table_info("accounts")').all() as Array<{
      name: string; notnull: number; dflt_value: string | null;
    }>;
    const col = cols.find((c) => c.name === 'issuer');
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(1);
    expect(col!.dflt_value).toBeNull();
  } finally {
    raw.close();
  }
}

/**
 * Imports the real db + auth-server modules AFTER DATABASE_URL is set. Their
 * import-time side effects (migrations, fixAccountsSchema, data migrations)
 * mirror a container start.
 */
async function bootApp() {
  const dbModule = await import('../../src/lib/db');
  const schema = await import('../../src/lib/db/schema');
  const { getAuth } = await import('../../src/lib/auth-server');
  return { db: dbModule.default, schema, getAuth };
}

/** Mirrors init-db.ts: create the admin user and its credential account directly. */
async function seedAdmin(db: Awaited<ReturnType<typeof bootApp>>['db'], schema: Awaited<ReturnType<typeof bootApp>>['schema']) {
  const { CREDENTIAL_ACCOUNT_ISSUER } = await import('../../src/lib/account-issuer');
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 4);
  const now = new Date().toISOString();
  const [user] = await db
    .insert(schema.users)
    .values({
      email: ADMIN_EMAIL,
      username: ADMIN_EMAIL,
      displayUsername: 'admin',
      role: 'admin',
      status: 'active',
      provider: 'credentials',
      passwordHash: hash,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  db.insert(schema.accounts).values({
    userId: user.id,
    issuer: CREDENTIAL_ACCOUNT_ISSUER,
    accountId: user.id.toString(),
    providerId: 'credential',
    password: hash,
    createdAt: now,
    updatedAt: now,
  }).run();
  return user;
}

async function checkSchema(auth: Awaited<ReturnType<Awaited<ReturnType<typeof bootApp>>['getAuth']>>) {
  await ((await auth.$context) as { checkSchema?: () => Promise<void> }).checkSchema?.();
}

describe('Better Auth schema contract for accounts.issuer (#283)', () => {
  it('fresh install: issuer carries a default, Better Auth accepts the schema, sign-up/sign-in work', async () => {
    // Self-registration on: signUpEmail exercises the real account.create.before
    // hook and the real INSERT that SCHEMA_MISMATCH used to veto.
    resetDbModule('fresh-install.db', { AUTH_ALLOW_SELF_REGISTRATION: 'true' });
    const { db, schema, getAuth } = await bootApp();

    const col = issuerColumn();
    expect(col.notnull).toBe(1);
    expect(col.dflt_value).not.toBeNull();

    const auth = getAuth();
    expect(typeof ((await auth.$context) as { checkSchema?: unknown }).checkSchema).toBe('function');
    await checkSchema(auth); // must not throw SCHEMA_MISMATCH

    // signUpEmail's inferred type lacks the username plugin's extra field.
    const signUpEmail = auth.api.signUpEmail as unknown as (
      args: { body: Record<string, unknown> }
    ) => Promise<{ user?: { email?: string; id?: string } | null }>;
    const signedUp = await signUpEmail({
      body: { email: 'fresh@example.com', password: 'Fresh-User-Password-123', name: 'Fresh', username: 'fresh' },
    });
    expect(signedUp?.user?.email).toBe('fresh@example.com');

    const [freshAccount] = db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.providerId, 'credential'),
          eq(schema.accounts.accountId, String(signedUp?.user?.id))
        )
      )
      .all();
    expect(freshAccount?.issuer).toBe('local:credential'); // derived by the hook

    const signedIn = await auth.api.signInEmail({
      body: { email: 'fresh@example.com', password: 'Fresh-User-Password-123' },
    });
    expect(signedIn?.user?.email).toBe('fresh@example.com');
  });

  it('upgraded database: boot repair rebuilds the pre-0025 shape and logins keep working', async () => {
    resetDbModule('upgrade.db', { AUTH_ALLOW_SELF_REGISTRATION: undefined });
    const { db, schema } = await bootApp();
    const user = await seedAdmin(db, schema);
    globalForDb.__SQLITE_CLIENT__?.close();

    regressToLegacyAccountsShape();

    // Reboot the app against the legacy-shape database, exactly like
    // upgrading a ≤ v1.11.2 deployment to the fixed image.
    resetDbModule('upgrade.db', { AUTH_ALLOW_SELF_REGISTRATION: undefined });
    const rebooted = await bootApp();

    const col = issuerColumn();
    expect(col.notnull).toBe(1); // NOT NULL bookkeeping invariant kept
    expect(col.dflt_value).not.toBeNull(); // repaired at boot

    const auth = rebooted.getAuth();
    await checkSchema(auth);

    const signedIn = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(signedIn?.user?.email).toBe(ADMIN_EMAIL);
    expect(signedIn?.user?.id).toBe(String(user.id)); // row survived the rebuild
  });

  it('unwritable database: boot repair fails with an actionable SQLITE_READONLY message', async () => {
    resetDbModule('readonly.db', { AUTH_ALLOW_SELF_REGISTRATION: undefined });
    const { db, schema } = await bootApp();
    await seedAdmin(db, schema);
    globalForDb.__SQLITE_CLIENT__?.close();
    regressToLegacyAccountsShape();

    chmodSync(dbPath, 0o444);
    try {
      resetDbModule('readonly.db', { AUTH_ALLOW_SELF_REGISTRATION: undefined });
      await expect(bootApp()).rejects.toThrow(/SQLITE_READONLY|readonly/i);
      await expect(bootApp()).rejects.toThrow(/chown 10001:10001/);
    } finally {
      chmodSync(dbPath, 0o644);
    }
  });
});
