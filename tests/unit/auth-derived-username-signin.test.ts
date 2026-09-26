/**
 * A username CPM makes from an email the login page refuses (here one with a
 * '+') works on Better Auth's username sign-in, whatever case it is typed in,
 * including for accounts that older releases stored such an email for as the
 * username, once they are repaired without the user signing in.
 *
 * Like auth-password-policy-endpoints.test.ts, this boots the real db module
 * and the real auth-server (no better-auth stub) against a file-backed SQLite
 * database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CREDENTIAL_ACCOUNT_ISSUER } from '../../src/lib/account-issuer';

const workDir = mkdtempSync(join(tmpdir(), 'cpm-derived-username-'));
const PASSWORD = 'Correct-Horse-9!';

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
  process.env.BASE_URL = 'http://localhost:3000';
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
  delete process.env.AUTH_RATE_LIMIT_ENABLED;
  vi.resetModules();
});

async function signIn(username: string, password: string): Promise<string | undefined> {
  const signInUsername = (app.auth.api as unknown as Record<string, (args: { body: Record<string, unknown> }) => Promise<unknown>>)
    .signInUsername;
  const result = (await signInUsername({ body: { username, password } })) as { user?: { id?: string } };
  return result.user?.id;
}

/** signIn, or null when Better Auth rejects the attempt. */
async function trySignIn(username: string, password: string): Promise<string | null> {
  try {
    return (await signIn(username, password)) ?? null;
  } catch {
    return null;
  }
}

/**
 * A credential-only account as older releases created it: the email, here
 * plus-addressed, copied as the username.
 */
async function seedLegacyCredentialUser(email: string) {
  const { db, schema } = app;
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(PASSWORD, 4);
  const [user] = await db.insert(schema.users).values({
    email,
    username: email,
    displayUsername: email.split('@')[0],
    name: null,
    passwordHash: hash,
    role: 'user',
    status: 'active',
    provider: 'credentials',
    subject: email,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  }).returning();
  await db.insert(schema.accounts).values({
    userId: user.id,
    issuer: CREDENTIAL_ACCOUNT_ISSUER,
    accountId: String(user.id),
    providerId: 'credential',
    password: hash,
    createdAt: now,
    updatedAt: now,
  });
  return user;
}

describe('derived sign-in usernames', () => {
  it('signs in a plus-addressed OAuth user who set a password through CPM', async () => {
    const { db, schema, userModel } = app;
    const now = new Date().toISOString();
    // The way an OAuth sign-up provisions a user: no username, no password.
    const [user] = await db.insert(schema.users).values({
      email: 'dex+cpm@example.com',
      name: 'Dex User',
      role: 'user',
      status: 'active',
      provider: 'dex',
      subject: 'dex-subject',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await userModel.changeUserPassword(user.id, bcrypt.hashSync(PASSWORD, 4), null);

    expect(await userModel.getPasswordSignInUsername(user.id)).toBe('dex-cpm@example.com');
    expect(await signIn('dex-cpm@example.com', PASSWORD)).toBe(String(user.id));
    expect(await signIn('Dex-CPM@Example.com', PASSWORD)).toBe(String(user.id));
  });

  it('signs in a plus-addressed user an administrator created', async () => {
    const user = await app.userModel.createUser({
      email: 'carol+cpm@example.com',
      provider: 'credentials',
      subject: 'carol+cpm@example.com',
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
    });

    expect(await signIn('carol-cpm@example.com', PASSWORD)).toBe(String(user.id));
  });

  it('signs in a legacy plus-addressed credential user after the startup repair', async () => {
    const user = await seedLegacyCredentialUser('erin+cpm@example.com');
    expect(await trySignIn('erin+cpm@example.com', PASSWORD)).toBeNull();
    expect(await trySignIn('erin-cpm@example.com', PASSWORD)).toBeNull();

    await app.userModel.repairLoginUsernames();

    expect(await signIn('erin-cpm@example.com', PASSWORD)).toBe(String(user.id));
  });

  it('signs in a legacy plus-addressed credential user after an administrator edits them', async () => {
    const user = await seedLegacyCredentialUser('fay+cpm@example.com');

    await app.userModel.updateUserProfile(user.id, { name: 'Fay' });

    expect(await signIn('fay-cpm@example.com', PASSWORD)).toBe(String(user.id));
  });
});
