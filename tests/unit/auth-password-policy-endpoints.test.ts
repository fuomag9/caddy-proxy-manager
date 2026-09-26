/**
 * CPM's password policy applies to the Better Auth endpoints that are still
 * enabled and set a password (self-registration and password reset), and a
 * password set through CPM works on Better Auth's credential login.
 *
 * Like auth-accounts-issuer-schema.test.ts, this boots the real db module and
 * the real auth-server (no better-auth stub) against a file-backed SQLite
 * database, so the hooks run exactly as they do in production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workDir = mkdtempSync(join(tmpdir(), 'cpm-password-policy-'));
const APP_BASE_URL = 'http://localhost:3000';

const globalForDb = globalThis as {
  __SQLITE_CLIENT__?: { close: () => void };
  __DRIZZLE_DB__?: unknown;
  __MIGRATIONS_RAN__?: boolean;
};

function resetGlobals() {
  globalForDb.__SQLITE_CLIENT__?.close();
  delete globalForDb.__SQLITE_CLIENT__;
  delete globalForDb.__DRIZZLE_DB__;
  delete globalForDb.__MIGRATIONS_RAN__;
}

type App = {
  db: Awaited<typeof import('../../src/lib/db')>['default'];
  schema: typeof import('../../src/lib/db/schema');
  auth: ReturnType<Awaited<typeof import('../../src/lib/auth-server')>['getAuth']>;
  userModel: typeof import('../../src/lib/models/user');
};
let app: App;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${join(workDir, 'app.db')}`;
  // Vitest leaks Vite's BASE_URL='/' into process.env, which better-auth rejects.
  process.env.BASE_URL = APP_BASE_URL;
  process.env.AUTH_ALLOW_SELF_REGISTRATION = 'true';
  process.env.AUTH_RATE_LIMIT_ENABLED = 'false';
  resetGlobals();
  vi.resetModules();

  const dbModule = await import('../../src/lib/db');
  const schema = await import('../../src/lib/db/schema');
  const { getAuth } = await import('../../src/lib/auth-server');
  const userModel = await import('../../src/lib/models/user');
  app = { db: dbModule.default, schema, auth: getAuth(), userModel };
});

afterAll(() => {
  resetGlobals();
  rmSync(workDir, { recursive: true, force: true });
  process.env.DATABASE_URL = ':memory:';
  delete process.env.AUTH_ALLOW_SELF_REGISTRATION;
  delete process.env.AUTH_RATE_LIMIT_ENABLED;
  vi.resetModules();
});

type ApiCall = (args: { body: Record<string, unknown> }) => Promise<unknown>;
const api = (name: string) => (app.auth.api as unknown as Record<string, ApiCall>)[name];

/** The APIError a Better Auth API call rejects with. */
async function apiError(call: Promise<unknown>) {
  const error = await call.then(
    () => { throw new Error('expected the call to be rejected'); },
    (e: unknown) => e as { statusCode?: number; status?: string; message?: string; body?: { message?: string } }
  );
  return { statusCode: error.statusCode, message: error.body?.message ?? error.message };
}

function signUpBody(email: string, password: string) {
  return { email, password, name: email.split('@')[0], username: email.split('@')[0] };
}

describe('Better Auth password endpoints follow the CPM password policy', () => {
  it('rejects a self-registration password that is too short', async () => {
    const error = await apiError(api('signUpEmail')({ body: signUpBody('short@example.com', 'short123') }));
    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/at least 12 characters/);
  });

  it('rejects a long self-registration password that misses the complexity rules', async () => {
    const error = await apiError(api('signUpEmail')({ body: signUpBody('weak@example.com', 'passwordpassword1') }));
    expect(error.statusCode).toBe(400);
    expect(error.message).toMatch(/uppercase and lowercase/);
    expect(error.message).toMatch(/special character/);
  });

  it('rejects a weak self-registration password over HTTP too', async () => {
    const res = await app.auth.handler(new Request(`${APP_BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_BASE_URL },
      body: JSON.stringify(signUpBody('http@example.com', 'password1')),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/at least 12 characters/);
  });

  it('accepts a compliant self-registration password', async () => {
    const result = (await api('signUpEmail')({
      body: signUpBody('strong@example.com', 'Strong-Password-2026!'),
    })) as { user?: { id?: string; email?: string } };
    expect(result.user?.email).toBe('strong@example.com');

    // Better Auth stores the hash on the credential account only; CPM still
    // counts it as a password (change-password, profile, unlink-oauth).
    const user = await app.userModel.getUserById(Number(result.user?.id));
    expect(user?.passwordHash).toBeNull();
    const hash = await app.userModel.getUserPasswordHash(user!);
    expect(hash && (await bcrypt.compare('Strong-Password-2026!', hash))).toBe(true);
  });

  it('rejects a weak password on reset before looking at the token', async () => {
    const weak = await apiError(api('resetPassword')({ body: { newPassword: 'password1', token: 'bogus' } }));
    expect(weak.statusCode).toBe(400);
    expect(weak.message).toMatch(/at least 12 characters/);

    // A compliant password gets as far as the token check.
    const strong = await apiError(api('resetPassword')({ body: { newPassword: 'Strong-Password-2026!', token: 'bogus' } }));
    expect(strong.statusCode).toBe(400);
    expect(strong.message).not.toMatch(/Password must/);
  });

  it('signs in an OAuth-only user by email once they set a password through CPM', async () => {
    const { db, schema, userModel } = app;
    const now = new Date().toISOString();
    // The way an OAuth sign-up provisions a user: no username, no password.
    const [user] = await db.insert(schema.users).values({
      email: 'dexuser@example.com',
      name: 'Dex User',
      role: 'user',
      status: 'active',
      provider: 'dex',
      subject: 'dex-subject',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    }).returning();
    db.insert(schema.accounts).values({
      userId: user.id,
      issuer: 'https://dex.example.com',
      accountId: 'dex-subject',
      providerId: 'dex',
      createdAt: now,
      updatedAt: now,
    }).run();
    expect(await userModel.getPasswordSignInUsername(user.id)).toBeNull();

    await userModel.changeUserPassword(user.id, bcrypt.hashSync('Correct-Horse-9!', 4), null);

    expect(await userModel.getPasswordSignInUsername(user.id)).toBe('dexuser@example.com');
    const signedIn = (await api('signInUsername')({
      body: { username: 'dexuser@example.com', password: 'Correct-Horse-9!' },
    })) as { user?: { id?: string } };
    expect(signedIn.user?.id).toBe(String(user.id));
  });
});
