/**
 * AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS=true opt-out of the H3 enforcement: when an
 * operator explicitly trusts their IdP, the user.create.before hook must leave
 * the IdP-provided role/status intact instead of forcing safe defaults.
 *
 * The flag is read from env at config import, so it is set in a hoisted block
 * before any imports and cleaned up afterwards. (The default-secure path is
 * covered in auth-oauth-role-injection.test.ts.)
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  process.env.AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS = 'true';
  return { db: null as unknown as TestDb };
});

afterAll(() => {
  delete process.env.AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS;
});

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    get sqlite() { return undefined; },
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (v: string | Date | null | undefined): string | null =>
      !v ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString(),
  };
});

vi.mock('better-auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  betterAuth: (options: any) => ({ options }),
}));
vi.mock('better-auth/plugins', () => ({
  genericOAuth: () => ({}),
  username: () => ({}),
}));

import { getAuth } from '../../src/lib/auth-server';

describe('OAuth role-from-claims opt-in (AUTH_ALLOW_OAUTH_ROLE_FROM_CLAIMS=true)', () => {
  it('leaves IdP-provided role/status intact instead of forcing defaults', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = getAuth() as any;
    const hook = auth.options.databaseHooks.user.create.before;

    const result = await hook({
      email: 'trusted@idp.example',
      name: 'Trusted',
      role: 'admin',
      status: 'active',
    });

    expect(result.data.role).toBe('admin'); // claim honored — not forced to "user"
    expect(result.data.status).toBe('active');
  });
});
