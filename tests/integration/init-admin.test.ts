/**
 * ensureAdminUser applies ADMIN_USERNAME/ADMIN_PASSWORD when the admin is
 * created or when those environment values change — not on every start, which
 * used to revert a password changed in the UI back to the environment value.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({
  db: null as unknown as TestDb,
  config: {
    sessionSecret: 'test-session-secret-for-vitest-unit-tests-12345',
    adminUsername: 'admin',
    adminPassword: 'Env-Password-2026!',
  },
}));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});
vi.mock('../../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/config')>()),
  config: ctx.config,
}));

import * as schema from '../../src/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { ensureAdminUser } from '../../src/lib/init-db';

const MARKER_KEY = 'admin_env_credentials_fingerprint';

async function adminRow() {
  return (await ctx.db.select().from(schema.users).where(eq(schema.users.id, 1)).get())!;
}

async function adminHash(): Promise<string> {
  return (await adminRow()).passwordHash!;
}

async function accountHash(): Promise<string> {
  const row = await ctx.db.select().from(schema.accounts).where(eq(schema.accounts.userId, 1)).get();
  return row!.password!;
}

/** Set the admin's password as a UI change does (users and accounts). */
async function setAdminPassword(password: string) {
  const hash = bcrypt.hashSync(password, 4);
  await ctx.db.update(schema.users).set({ passwordHash: hash }).where(eq(schema.users.id, 1));
  await ctx.db.update(schema.accounts).set({ password: hash }).where(eq(schema.accounts.userId, 1));
  return hash;
}

/** The state of a database written before the environment marker existed. */
async function forgetMarker() {
  await ctx.db.delete(schema.settings).where(eq(schema.settings.key, MARKER_KEY));
}

async function storedMarker(): Promise<unknown> {
  const row = await ctx.db.select().from(schema.settings).where(eq(schema.settings.key, MARKER_KEY)).get();
  return row ? JSON.parse(row.value) : null;
}

async function signIn(userId: number) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  await ctx.db.insert(schema.sessions).values({
    userId, token: `token-${userId}-${Math.random()}`, expiresAt: expires, createdAt: now, updatedAt: now,
  });
  const [host] = await ctx.db.insert(schema.proxyHosts).values({
    name: 'App', domains: JSON.stringify(['app.example.com']), upstreams: JSON.stringify(['backend:8080']),
    sslForced: true, hstsEnabled: true, hstsSubdomains: false, allowWebsocket: true, preserveHostHeader: true,
    skipHttpsHostnameValidation: false, enabled: true, createdAt: now, updatedAt: now,
  }).returning();
  await ctx.db.insert(schema.forwardAuthSessions).values({
    userId, proxyHostId: host.id, audienceOrigin: 'https://app.example.com',
    tokenHash: `hash-${userId}-${Math.random()}`, expiresAt: expires, createdAt: now,
  });
}

async function sessionCounts(userId: number) {
  const sessions = await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).all();
  const forwardAuth = await ctx.db.select().from(schema.forwardAuthSessions)
    .where(eq(schema.forwardAuthSessions.userId, userId)).all();
  return { sessions: sessions.length, forwardAuth: forwardAuth.length };
}

beforeEach(async () => {
  await ctx.db.delete(schema.forwardAuthSessions);
  await ctx.db.delete(schema.sessions);
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.accounts);
  await ctx.db.delete(schema.settings);
  await ctx.db.delete(schema.users);
  ctx.config.adminUsername = 'admin';
  ctx.config.adminPassword = 'Env-Password-2026!';
  ctx.config.sessionSecret = 'test-session-secret-for-vitest-unit-tests-12345';
  vi.restoreAllMocks();
});

// bcrypt at the production cost makes each start take a few hundred ms.
describe('ensureAdminUser', { timeout: 20_000 }, () => {
  it('keeps a password changed in the UI across restarts', async () => {
    await ensureAdminUser();
    expect(bcrypt.compareSync('Env-Password-2026!', await adminHash())).toBe(true);

    const uiHash = await setAdminPassword('Changed-In-Ui-2026!');

    await ensureAdminUser();
    expect(await adminHash()).toBe(uiHash);
    expect(await accountHash()).toBe(uiHash);
  });

  it('applies new environment credentials when they change', async () => {
    await ensureAdminUser();
    await setAdminPassword('Changed-In-Ui-2026!');
    await ctx.db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, 1));

    ctx.config.adminPassword = 'Recovery-Password-2026!';
    await ensureAdminUser();

    const row = await adminRow();
    expect(bcrypt.compareSync('Recovery-Password-2026!', row.passwordHash!)).toBe(true);
    expect(bcrypt.compareSync('Recovery-Password-2026!', await accountHash())).toBe(true);
    expect(row.role).toBe('admin');
  });

  it('re-activates a disabled primary admin when the environment credentials change', async () => {
    await ensureAdminUser();
    await ctx.db.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.id, 1));

    ctx.config.adminPassword = 'Recovery-Password-2026!';
    await ensureAdminUser();

    expect((await adminRow()).status).toBe('active');
  });

  it("ends the admin's existing sessions when the environment sets a new password", async () => {
    await ensureAdminUser();
    const now = new Date().toISOString();
    const [other] = await ctx.db.insert(schema.users).values({
      email: 'other@example.com', role: 'user', status: 'active', createdAt: now, updatedAt: now,
    }).returning();
    await signIn(1);
    await signIn(other.id);

    ctx.config.adminPassword = 'Recovery-Password-2026!';
    await ensureAdminUser();

    expect(await sessionCounts(1)).toEqual({ sessions: 0, forwardAuth: 0 });
    expect(await sessionCounts(other.id)).toEqual({ sessions: 1, forwardAuth: 1 });
  });

  it('ends the sessions on the next start when applying a new password failed part-way', async () => {
    await ensureAdminUser();
    await signIn(1);
    ctx.config.adminPassword = 'Recovery-Password-2026!';

    ctx.db.run(sql`CREATE TRIGGER fail_forward_auth_delete BEFORE DELETE ON forward_auth_sessions
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);
    try {
      await expect(ensureAdminUser()).rejects.toThrow(/simulated failure/);
    } finally {
      ctx.db.run(sql`DROP TRIGGER fail_forward_auth_delete`);
    }
    // The password did not change without the sessions being ended.
    expect(bcrypt.compareSync('Env-Password-2026!', await adminHash())).toBe(true);
    expect(await sessionCounts(1)).toEqual({ sessions: 1, forwardAuth: 1 });

    await ensureAdminUser();

    expect(bcrypt.compareSync('Recovery-Password-2026!', await adminHash())).toBe(true);
    expect(bcrypt.compareSync('Recovery-Password-2026!', await accountHash())).toBe(true);
    expect(await sessionCounts(1)).toEqual({ sessions: 0, forwardAuth: 0 });
  });

  it('keeps sessions when the applied password is unchanged', async () => {
    await ensureAdminUser();
    await signIn(1);

    ctx.config.adminUsername = 'root';
    await ensureAdminUser();

    expect((await adminRow()).username).toBe('root');
    expect(await sessionCounts(1)).toEqual({ sessions: 1, forwardAuth: 1 });
  });

  it('does not re-apply the environment when only SESSION_SECRET changes', async () => {
    await ensureAdminUser();
    const uiHash = await setAdminPassword('Changed-In-Ui-2026!');
    await ctx.db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, 1));

    ctx.config.sessionSecret = 'a-rotated-session-secret-0123456789abcdef';
    await ensureAdminUser();

    const row = await adminRow();
    expect(row.passwordHash).toBe(uiHash);
    expect(row.role).toBe('user');
  });

  it('records the applied credentials as a bcrypt hash, not a fast hash of the password', async () => {
    await ensureAdminUser();

    const marker = await storedMarker() as { v: number; username: string; passwordHash: string };
    expect(marker.v).toBe(2);
    expect(marker.username).toBe('admin');
    expect(marker.passwordHash).toMatch(/^\$2[aby]\$\d\d\$/);
    expect(bcrypt.compareSync('Env-Password-2026!', marker.passwordHash)).toBe(true);
    expect(JSON.stringify(marker)).not.toContain('Env-Password-2026!');
  });

  describe('first start without a marker (upgrade)', () => {
    it('keeps a password that no longer matches the environment, and says so', async () => {
      await ensureAdminUser();
      await forgetMarker();
      const uiHash = await setAdminPassword('Changed-In-Ui-2026!');
      const warn = vi.spyOn(console, 'warn');

      await ensureAdminUser();

      expect(await adminHash()).toBe(uiHash);
      expect(await accountHash()).toBe(uiHash);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ADMIN_PASSWORD differs from the stored admin password/));
    });

    it('applies an environment password changed at upgrade time once it is changed again', async () => {
      await ensureAdminUser();
      await forgetMarker();
      const uiHash = await setAdminPassword('Changed-In-Ui-2026!');

      ctx.config.adminPassword = 'Changed-At-Upgrade-2026!';
      await ensureAdminUser();
      expect(await adminHash()).toBe(uiHash);

      // Restarting with the same environment keeps the stored password...
      await ensureAdminUser();
      expect(await adminHash()).toBe(uiHash);

      // ...and changing it again applies it.
      ctx.config.adminPassword = 'Changed-Again-2026!';
      await ensureAdminUser();
      expect(bcrypt.compareSync('Changed-Again-2026!', await adminHash())).toBe(true);
    });

    it.each(['Your-Secure-P@ssw0rd-Here!', 'YourStr0ng-P@ssw0rd123!', 'admin'])(
      'replaces the publicly known password %s with the environment one',
      async (publicPassword) => {
        await ensureAdminUser();
        await forgetMarker();
        await setAdminPassword(publicPassword);
        await signIn(1);

        ctx.config.adminPassword = 'Operator-Chosen-2026!';
        await ensureAdminUser();

        expect(bcrypt.compareSync('Operator-Chosen-2026!', await adminHash())).toBe(true);
        expect(bcrypt.compareSync('Operator-Chosen-2026!', await accountHash())).toBe(true);
        expect(bcrypt.compareSync(publicPassword, await accountHash())).toBe(false);
        expect(await sessionCounts(1)).toEqual({ sessions: 0, forwardAuth: 0 });

        // Later restarts keep it.
        await ensureAdminUser();
        expect(bcrypt.compareSync('Operator-Chosen-2026!', await adminHash())).toBe(true);
      }
    );

    it('applies the environment when it matches the stored password', async () => {
      await ensureAdminUser();
      await forgetMarker();
      await ctx.db.update(schema.users).set({ role: 'user' }).where(eq(schema.users.id, 1));
      const hash = await adminHash();

      await ensureAdminUser();

      const row = await adminRow();
      expect(row.role).toBe('admin');
      expect(row.passwordHash).toBe(hash);
      expect(await storedMarker()).toMatchObject({ v: 2, username: 'admin' });
    });

    it('leaves a disabled primary admin disabled when the environment is unchanged', async () => {
      await ensureAdminUser();
      await forgetMarker();
      await ctx.db.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.id, 1));

      await ensureAdminUser();
      expect((await adminRow()).status).toBe('disabled');

      // Later restarts, now with a marker, keep it disabled too.
      await ensureAdminUser();
      expect((await adminRow()).status).toBe('disabled');
    });

    it('makes the admin active again when it replaces a publicly known password', async () => {
      await ensureAdminUser();
      await forgetMarker();
      await setAdminPassword('admin');
      await ctx.db.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.id, 1));

      await ensureAdminUser();

      expect((await adminRow()).status).toBe('active');
    });

    it('applies a changed ADMIN_USERNAME while keeping a password changed in the UI', async () => {
      await ensureAdminUser();
      await forgetMarker();
      const uiHash = await setAdminPassword('Changed-In-Ui-2026!');
      await ctx.db.update(schema.users).set({ status: 'disabled' }).where(eq(schema.users.id, 1));

      ctx.config.adminUsername = 'Root';
      await ensureAdminUser();

      const row = await adminRow();
      expect(row).toMatchObject({
        username: 'root', displayUsername: 'Root', email: 'Root@localhost', subject: 'Root', status: 'disabled',
      });
      expect(row.passwordHash).toBe(uiHash);
      expect(await accountHash()).toBe(uiHash);

      // Later restarts keep both.
      await ensureAdminUser();
      expect(await adminRow()).toMatchObject({ username: 'root', passwordHash: uiHash });
    });

    it('treats a value that is not a marker (such as an older fingerprint) as no marker', async () => {
      await ensureAdminUser();
      await ctx.db.update(schema.settings)
        .set({ value: JSON.stringify('9f2c'.repeat(16)) })
        .where(eq(schema.settings.key, MARKER_KEY));
      const uiHash = await setAdminPassword('Changed-In-Ui-2026!');

      await ensureAdminUser();

      expect(await adminHash()).toBe(uiHash);
      expect(await storedMarker()).toMatchObject({ v: 2, username: 'admin' });
    });
  });
});
