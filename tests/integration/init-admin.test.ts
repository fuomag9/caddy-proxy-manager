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
vi.mock('../../src/lib/config', () => ({ config: ctx.config }));

import * as schema from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureAdminUser } from '../../src/lib/init-db';

async function adminHash(): Promise<string> {
  const row = await ctx.db.select().from(schema.users).where(eq(schema.users.id, 1)).get();
  return row!.passwordHash!;
}

beforeEach(async () => {
  await ctx.db.delete(schema.accounts);
  await ctx.db.delete(schema.settings);
  await ctx.db.delete(schema.users);
  ctx.config.adminPassword = 'Env-Password-2026!';
});

describe('ensureAdminUser', () => {
  it('keeps a password changed in the UI across restarts', async () => {
    await ensureAdminUser();
    expect(bcrypt.compareSync('Env-Password-2026!', await adminHash())).toBe(true);

    const uiHash = bcrypt.hashSync('Changed-In-Ui-2026!', 4);
    await ctx.db.update(schema.users).set({ passwordHash: uiHash }).where(eq(schema.users.id, 1));

    await ensureAdminUser();
    expect(await adminHash()).toBe(uiHash);
  });

  it('applies new environment credentials when they change', async () => {
    await ensureAdminUser();
    await ctx.db.update(schema.users)
      .set({ passwordHash: bcrypt.hashSync('Changed-In-Ui-2026!', 4), role: 'user' })
      .where(eq(schema.users.id, 1));

    ctx.config.adminPassword = 'Recovery-Password-2026!';
    await ensureAdminUser();

    const row = await ctx.db.select().from(schema.users).where(eq(schema.users.id, 1)).get();
    expect(bcrypt.compareSync('Recovery-Password-2026!', row!.passwordHash!)).toBe(true);
    expect(row!.role).toBe('admin');
  });

  it('on upgrade (no fingerprint yet) keeps a password that no longer matches the environment', async () => {
    await ensureAdminUser();
    await ctx.db.delete(schema.settings);
    const uiHash = bcrypt.hashSync('Changed-In-Ui-2026!', 4);
    await ctx.db.update(schema.users).set({ passwordHash: uiHash }).where(eq(schema.users.id, 1));

    await ensureAdminUser();
    expect(await adminHash()).toBe(uiHash);
  });
});
