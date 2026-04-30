import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const migrationsFolder = resolve(process.cwd(), 'drizzle');

function resetDbModuleState() {
  vi.resetModules();
  delete (globalThis as typeof globalThis & { __DRIZZLE_DB__?: unknown }).__DRIZZLE_DB__;
  delete (globalThis as typeof globalThis & { __SQLITE_CLIENT__?: unknown }).__SQLITE_CLIENT__;
  delete (globalThis as typeof globalThis & { __MIGRATIONS_RAN__?: boolean }).__MIGRATIONS_RAN__;
}

function createBrokenAccountsDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });

  sqlite.exec(`
    ALTER TABLE accounts RENAME TO accounts_old;
    CREATE TABLE accounts (
      id TEXT NOT NULL,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    )
    SELECT
      CAST(id AS TEXT), userId, accountId, providerId, accessToken, refreshToken, idToken,
      accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt
    FROM accounts_old;
    DROP TABLE accounts_old;
    CREATE UNIQUE INDEX accounts_provider_account_idx ON accounts (providerId, accountId);
    CREATE INDEX accounts_user_idx ON accounts (userId);
  `);

  sqlite.close();
}

describe('database compatibility for accounts schema', () => {
  afterEach(() => {
    process.env.DATABASE_URL = ':memory:';
    resetDbModuleState();
  });

  it('repairs legacy accounts.id schema and allows credential account creation', async () => {
    const tempDir = mkdtempSync(join(process.cwd(), 'tmp-db-compat-'));
    const dbPath = join(tempDir, 'compat.db');

    try {
      createBrokenAccountsDatabase(dbPath);

      process.env.DATABASE_URL = `file:${dbPath}`;
      resetDbModuleState();

      const { createUser } = await import('@/src/lib/models/user');
      await createUser({
        email: 'compat-user@example.com',
        name: 'Compat User',
        role: 'user',
        provider: 'credentials',
        subject: 'compat-user',
        passwordHash: 'hash123',
      });

      const sqlite = new Database(dbPath, { readonly: true });
      const accountColumns = sqlite.prepare('PRAGMA table_info("accounts")').all() as Array<{
        name: string;
        type: string;
        pk: number;
      }>;
      const idColumn = accountColumns.find((column) => column.name === 'id');
      expect(idColumn).toBeDefined();
      expect(idColumn?.type.toUpperCase()).toBe('INTEGER');
      expect(idColumn?.pk).toBe(1);

      const user = sqlite.prepare('SELECT id FROM users WHERE email = ?').get('compat-user@example.com') as { id: number } | undefined;
      expect(user?.id).toBeDefined();

      const account = sqlite.prepare(
        'SELECT id, providerId, accountId, password FROM accounts WHERE userId = ? AND providerId = ?'
      ).get(user!.id, 'credential') as {
        id: number;
        providerId: string;
        accountId: string;
        password: string | null;
      } | undefined;

      expect(account).toBeDefined();
      expect(account?.id).toBeGreaterThan(0);
      expect(account?.providerId).toBe('credential');
      expect(account?.accountId).toBe(String(user!.id));
      expect(account?.password).toBe('hash123');

      sqlite.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
