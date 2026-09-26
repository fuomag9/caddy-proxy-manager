/**
 * Integration tests for password storage on user accounts against a real
 * (in-memory) database:
 *
 *  - setting a password keeps users.passwordHash and the Better Auth
 *    credential account in step, creating the credential account for an
 *    OAuth-only user (the login page checks only that account) and giving a
 *    user without a usable username one made from their email (the login
 *    page signs in by username): the email itself, the email with refused
 *    characters replaced, or a numbered variant when that is taken;
 *  - createUser picks the account's username the same way and returns it;
 *  - a user with a password but a username the login page cannot find them
 *    by is given one when their profile is updated and by the startup
 *    repair, without having to sign in first;
 *  - changeUserPassword ends the user's other sign-ins in the same
 *    transaction as the password write;
 *  - "has a password" counts a hash stored only on the credential account
 *    (Better Auth self-registration) in the change-password route;
 *  - unlink-oauth only goes ahead when the login page can still sign the
 *    user in: a username plus a password on the credential account, and the
 *    profile page gets the reason when it cannot.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { createTestDb, type TestDb } from '../helpers/db';
import { accounts, forwardAuthSessions, proxyHosts, sessions, users } from '@/src/lib/db/schema';
import { CREDENTIAL_ACCOUNT_ISSUER } from '@/src/lib/account-issuer';

let db: TestDb;

vi.mock('@/src/lib/db', () => ({
  get default() { return db; },
  get sqlite() { return undefined; },
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  },
}));

const caller = vi.hoisted(() => ({ userId: 0, sessionId: null as number | null, sessionCreatedAt: new Date() }));
vi.mock('@/src/lib/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: String(caller.userId), role: 'user' } })),
  checkSameOrigin: vi.fn(() => null),
  getCurrentSessionInfo: vi.fn(async () =>
    caller.sessionId === null ? null : { id: caller.sessionId, createdAt: caller.sessionCreatedAt }
  ),
}));

import {
  changeUserPassword,
  createUser,
  getPasswordSignInStatus,
  getPasswordSignInUsername,
  getUserById,
  getUserPasswordHash,
  repairLoginUsernames,
  updateUserProfile,
} from '@/src/lib/models/user';
import { POST as changePassword } from '@/app/api/user/change-password/route';
import { POST as unlinkOAuth } from '@/app/api/user/unlink-oauth/route';

const NOW = '2026-02-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const PASSWORD = 'Correct-Horse-9!';

async function seedUser(
  email: string,
  passwordHash: string | null = null,
  username: string | null = email
) {
  const [row] = await db.insert(users).values({
    email,
    username,
    name: email,
    role: 'user',
    provider: 'dex',
    subject: `sub-${email}`,
    passwordHash,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
  }).returning();
  return row.id;
}

async function seedOAuthAccount(userId: number) {
  await db.insert(accounts).values({
    userId,
    issuer: 'https://dex.example.com',
    accountId: `dex-${userId}`,
    providerId: 'dex',
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedCredentialAccount(userId: number, password: string | null) {
  await db.insert(accounts).values({
    userId,
    issuer: CREDENTIAL_ACCOUNT_ISSUER,
    accountId: String(userId),
    providerId: 'credential',
    password,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seedSession(id: number, userId: number) {
  await db.insert(sessions).values({
    id, userId, token: `tok-${id}`, expiresAt: FUTURE, createdAt: NOW, updatedAt: NOW,
  });
}

async function seedForwardAuthSession(userId: number) {
  const [host] = await db.insert(proxyHosts).values({
    name: `host-${userId}`,
    domains: JSON.stringify([`app${userId}.example.com`]),
    upstreams: JSON.stringify(['127.0.0.1:8080']),
    createdAt: NOW,
    updatedAt: NOW,
  }).returning();
  await db.insert(forwardAuthSessions).values({
    userId,
    proxyHostId: host.id,
    audienceOrigin: `https://app${userId}.example.com`,
    tokenHash: `hash-${userId}`,
    expiresAt: FUTURE,
    createdAt: NOW,
  });
}

function signInColumns(userId: number) {
  return db.select({ username: users.username, displayUsername: users.displayUsername })
    .from(users).where(eq(users.id, userId)).get();
}

function credentialRows(userId: number) {
  return db.select().from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .all();
}

function post(path: string, body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db = createTestDb();
  caller.sessionId = null;
  caller.sessionCreatedAt = new Date();
});

describe('changeUserPassword', () => {
  it('creates the credential account for an OAuth-only user', async () => {
    const userId = await seedUser('oauth@example.com');
    await seedOAuthAccount(userId);
    expect(credentialRows(userId)).toHaveLength(0);

    const hash = bcrypt.hashSync(PASSWORD, 4);
    await changeUserPassword(userId, hash, null);

    const [credential] = credentialRows(userId);
    expect(credential).toMatchObject({
      issuer: CREDENTIAL_ACCOUNT_ISSUER,
      accountId: String(userId),
      password: hash,
    });
    expect((await getUserById(userId))?.passwordHash).toBe(hash);
  });

  it('updates the existing credential account instead of adding another', async () => {
    const userId = await seedUser('local@example.com', 'old-hash');
    await seedCredentialAccount(userId, 'old-hash');

    await changeUserPassword(userId, 'new-hash', null);

    const rows = credentialRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].password).toBe('new-hash');
  });

  it('gives a user provisioned by OAuth sign-up their email as username', async () => {
    const userId = await seedUser('Dex.User@example.com', null, null);
    await seedOAuthAccount(userId);

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)).toEqual({
      username: 'dex.user@example.com',
      displayUsername: 'Dex.User@example.com',
    });
  });

  it('keeps an existing username and display name', async () => {
    const userId = await seedUser('alice@example.com', null, 'alice');
    db.update(users).set({ displayUsername: 'Alice A.' }).where(eq(users.id, userId)).run();

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)).toEqual({ username: 'alice', displayUsername: 'Alice A.' });
  });

  it('numbers the username when another user already signs in with the email', async () => {
    const holder = await seedUser('holder@example.com', null, 'dexuser@example.com');
    const userId = await seedUser('dexuser@example.com', null, null);

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)?.username).toBe('dexuser-2@example.com');
    expect(signInColumns(holder)?.username).toBe('dexuser@example.com');
    expect(await getPasswordSignInUsername(userId)).toBe('dexuser-2@example.com');
  });

  it('treats a username held in another case as taken', async () => {
    await seedUser('holder@example.com', null, 'DexUser@Example.com');
    const userId = await seedUser('dexuser@example.com', null, null);

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)?.username).toBe('dexuser-2@example.com');
  });

  it('replaces characters the login page refuses in an email-derived username', async () => {
    const userId = await seedUser('Dex+Tag@example.com', null, null);

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)).toEqual({ username: 'dex-tag@example.com', displayUsername: 'Dex+Tag@example.com' });
    expect(credentialRows(userId)[0].password).toBe('new-hash');
    expect(await getPasswordSignInUsername(userId)).toBe('dex-tag@example.com');
  });

  it('leaves the derived username to the user whose email it is', async () => {
    // Nobody signs in as dex-tag@example.com yet, but it is another user's email.
    await seedUser('dex-tag@example.com', null, null);
    await seedUser('holder@example.com', null, 'dex-tag-2@example.com');
    const userId = await seedUser('dex+tag@example.com', null, null);

    await changeUserPassword(userId, 'new-hash', null);

    expect(signInColumns(userId)?.username).toBe('dex-tag-3@example.com');
  });

  it('replaces a stored username the login page cannot find', async () => {
    // createUser and the Better Auth migration used to copy the email as is.
    const plus = await seedUser('alice+cpm@example.com', 'old-hash', 'alice+cpm@example.com');
    await seedCredentialAccount(plus, 'old-hash');
    await seedOAuthAccount(plus);
    const upper = await seedUser('bob@example.com', 'old-hash', 'Bob');
    await seedCredentialAccount(upper, 'old-hash');
    expect(await getPasswordSignInUsername(plus)).toBeNull();
    expect(await getPasswordSignInUsername(upper)).toBeNull();

    await changeUserPassword(plus, 'new-hash', null);
    await changeUserPassword(upper, 'new-hash', null);

    expect(await getPasswordSignInUsername(plus)).toBe('alice-cpm@example.com');
    expect(await getPasswordSignInUsername(upper)).toBe('bob@example.com');
  });

  it('ends the other sessions and all forward-auth sessions, keeping the given one', async () => {
    const userId = await seedUser('alice@example.com', 'old-hash');
    const otherId = await seedUser('bob@example.com', 'bob-hash');
    await seedCredentialAccount(userId, 'old-hash');
    await seedSession(10, userId);
    await seedSession(11, userId);
    await seedSession(20, otherId);
    await seedForwardAuthSession(userId);
    await seedForwardAuthSession(otherId);

    await changeUserPassword(userId, 'new-hash', 10);

    expect(credentialRows(userId)[0].password).toBe('new-hash');
    const remaining = db.select({ id: sessions.id }).from(sessions).all().map((r) => r.id).sort();
    expect(remaining).toEqual([10, 20]);
    const faOwners = db.select({ userId: forwardAuthSessions.userId }).from(forwardAuthSessions).all();
    expect(faOwners).toEqual([{ userId: otherId }]);
  });

  it('leaves the password unchanged when revoking the sessions fails', async () => {
    const userId = await seedUser('alice@example.com', 'old-hash');
    await seedCredentialAccount(userId, 'old-hash');
    await seedSession(10, userId);
    // Make the forward-auth delete fail inside the transaction.
    db.run(sql`DROP TABLE forward_auth_exchanges`);
    db.run(sql`DROP TABLE forward_auth_sessions`);

    await expect(changeUserPassword(userId, 'new-hash', null)).rejects.toThrow();

    expect((await getUserById(userId))?.passwordHash).toBe('old-hash');
    expect(credentialRows(userId)[0].password).toBe('old-hash');
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });
});

describe('createUser', () => {
  it('uses the email as username when the login page accepts it', async () => {
    const user = await createUser({ email: 'Carol@Example.com', provider: 'credentials', subject: 'carol', passwordHash: 'h' });
    expect(signInColumns(user.id)?.username).toBe('carol@example.com');
    expect(await getPasswordSignInUsername(user.id)).toBe('carol@example.com');
  });

  it('gives a plus-addressed email a username the login page accepts', async () => {
    const user = await createUser({ email: 'carol+cpm@example.com', provider: 'credentials', subject: 'carol', passwordHash: 'h' });
    expect(signInColumns(user.id)?.username).toBe('carol-cpm@example.com');
    expect(await getPasswordSignInUsername(user.id)).toBe('carol-cpm@example.com');
  });

  it('does not reuse a username another user signs in with', async () => {
    await seedUser('holder@example.com', null, 'carol@example.com');
    const user = await createUser({ email: 'carol@example.com', provider: 'credentials', subject: 'carol', passwordHash: 'h' });
    expect(signInColumns(user.id)?.username).toBe('carol-2@example.com');
    // Administrators see the name the user has to type in what createUser returns.
    expect(user.username).toBe('carol-2@example.com');
    expect((await getUserById(user.id))?.username).toBe('carol-2@example.com');
  });

  it('leaves a plain address to its owner when a similar one was created first', async () => {
    const plus = await createUser({ email: '+alice@example.com', provider: 'credentials', subject: 'a1', passwordHash: 'h' });
    const owner = await createUser({ email: 'alice@example.com', provider: 'credentials', subject: 'a2', passwordHash: 'h' });
    expect(plus.username).toBe('-alice@example.com');
    expect(owner.username).toBe('alice@example.com');
  });

  it('keeps an explicit username', async () => {
    const user = await createUser({ email: 'dave@example.com', provider: 'credentials', subject: 'dave', username: 'admin' });
    expect(signInColumns(user.id)?.username).toBe('admin');
  });
});

describe('getUserPasswordHash', () => {
  it('reads users.passwordHash, then the credential account, else null', async () => {
    const local = await seedUser('local@example.com', 'users-hash');
    const selfRegistered = await seedUser('self@example.com');
    await seedCredentialAccount(selfRegistered, 'account-hash');
    const oauthOnly = await seedUser('oauth@example.com');
    await seedOAuthAccount(oauthOnly);
    const emptyCredential = await seedUser('empty@example.com');
    await seedCredentialAccount(emptyCredential, null);

    expect(await getUserPasswordHash((await getUserById(local))!)).toBe('users-hash');
    expect(await getUserPasswordHash((await getUserById(selfRegistered))!)).toBe('account-hash');
    expect(await getUserPasswordHash((await getUserById(oauthOnly))!)).toBeNull();
    expect(await getUserPasswordHash((await getUserById(emptyCredential))!)).toBeNull();
  });
});

describe('getPasswordSignInUsername', () => {
  it('needs a login-page username and a password on the credential account', async () => {
    const local = await seedUser('local@example.com', 'users-hash');
    await seedCredentialAccount(local, 'users-hash');
    // Set a password before the credential account was kept in step.
    const legacy = await seedUser('legacy@example.com', 'users-hash');
    const noUsername = await seedUser('self@example.com', null, null);
    await seedCredentialAccount(noUsername, 'account-hash');
    const badUsername = await seedUser('bad@example.com', null, 'bad name');
    await seedCredentialAccount(badUsername, 'account-hash');
    const emptyCredential = await seedUser('empty@example.com');
    await seedCredentialAccount(emptyCredential, null);

    expect(await getPasswordSignInUsername(local)).toBe('local@example.com');
    expect(await getPasswordSignInUsername(legacy)).toBeNull();
    expect(await getPasswordSignInUsername(noUsername)).toBeNull();
    expect(await getPasswordSignInUsername(badUsername)).toBeNull();
    expect(await getPasswordSignInUsername(emptyCredential)).toBeNull();
  });
});

/** Takes every username that could be made from dex+tag@example.com. */
async function takeEveryDexTagUsername() {
  const emails = ['dex-tag@example.com'];
  for (let n = 2; n <= 1000; n++) emails.push(`dex-tag-${n}@example.com`);
  for (let i = 0; i < emails.length; i += 100) {
    await db.insert(users).values(emails.slice(i, i + 100).map((email) => ({
      email, name: email, role: 'user', status: 'active', createdAt: NOW, updatedAt: NOW,
    })));
  }
}

describe('getPasswordSignInStatus', () => {
  it('returns the username when the login page can sign the user in', async () => {
    const userId = await seedUser('local@example.com', 'hash');
    await seedCredentialAccount(userId, 'hash');
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: 'local@example.com', blocker: null });
  });

  it('reports no-credential when setting or changing the password fixes it', async () => {
    const oauthOnly = await seedUser('oauth@example.com', null, null);
    await seedOAuthAccount(oauthOnly);
    const legacy = await seedUser('legacy@example.com', 'users-hash');
    const plus = await seedUser('alice+cpm@example.com', null, 'alice+cpm@example.com');
    await seedCredentialAccount(plus, 'hash');

    for (const userId of [oauthOnly, legacy, plus]) {
      expect(await getPasswordSignInStatus(userId)).toEqual({ username: null, blocker: 'no-credential' });
      await changeUserPassword(userId, 'new-hash', null);
      expect((await getPasswordSignInStatus(userId)).blocker).toBeNull();
    }
  });

  it('reports no-username when no username can be made from the email', async () => {
    await takeEveryDexTagUsername();
    const userId = await seedUser('dex+tag@example.com', null, null);
    await seedOAuthAccount(userId);
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: null, blocker: 'no-username' });

    await changeUserPassword(userId, 'new-hash', null);
    expect(signInColumns(userId)?.username).toBeNull();
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: null, blocker: 'no-username' });

    // Their password is on the credential account, so a new email address
    // gives them a username without another password change.
    await updateUserProfile(userId, { email: 'dex@example.com' });
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: 'dex@example.com', blocker: null });
  });

  it('asks a user without a password to set one once the email allows a username', async () => {
    await takeEveryDexTagUsername();
    const userId = await seedUser('dex+tag@example.com', null, null);
    await seedOAuthAccount(userId);

    await updateUserProfile(userId, { email: 'dex@example.com' });
    expect(signInColumns(userId)?.username).toBeNull();
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: null, blocker: 'no-credential' });
  });
});

describe('password routes against the database', () => {
  it('lets an OAuth-only user set a password that the credential login can use', async () => {
    const userId = await seedUser('oauth@example.com', null, null);
    await seedOAuthAccount(userId);
    caller.userId = userId;
    caller.sessionId = 10;
    await seedSession(10, userId);

    const res = await changePassword(post('/api/user/change-password', { newPassword: PASSWORD }));
    expect(res.status).toBe(200);

    const [credential] = credentialRows(userId);
    expect(credential?.password).toBeTruthy();
    expect(await bcrypt.compare(PASSWORD, credential!.password!)).toBe(true);
    expect(await getPasswordSignInUsername(userId)).toBe('oauth@example.com');

    // With a working password sign-in, OAuth can now be unlinked.
    const unlinked = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(unlinked.status).toBe(200);
  });

  it('lets a plus-addressed OAuth-only user set a password and then unlink OAuth', async () => {
    const userId = await seedUser('alice+cpm@example.com', null, null);
    await seedOAuthAccount(userId);
    caller.userId = userId;
    caller.sessionId = 10;
    await seedSession(10, userId);

    const res = await changePassword(post('/api/user/change-password', { newPassword: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await getPasswordSignInUsername(userId)).toBe('alice-cpm@example.com');

    const unlinked = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(unlinked.status).toBe(200);
  });

  it('requires the current password of a self-registered user and syncs both copies', async () => {
    const userId = await seedUser('self@example.com');
    await seedCredentialAccount(userId, bcrypt.hashSync(PASSWORD, 4));
    caller.userId = userId;
    caller.sessionId = 10;
    await seedSession(10, userId);

    const withoutCurrent = await changePassword(post('/api/user/change-password', { newPassword: 'Another-Pass-2026!' }));
    expect(withoutCurrent.status).toBe(400);

    const res = await changePassword(post('/api/user/change-password', {
      currentPassword: PASSWORD,
      newPassword: 'Another-Pass-2026!',
    }));
    expect(res.status).toBe(200);
    const user = await getUserById(userId);
    expect(await bcrypt.compare('Another-Pass-2026!', user!.passwordHash!)).toBe(true);
    expect(credentialRows(userId)[0].password).toBe(user!.passwordHash);
  });

  it('lets a user whose password is only on the credential account unlink OAuth', async () => {
    const userId = await seedUser('self@example.com');
    await seedCredentialAccount(userId, bcrypt.hashSync(PASSWORD, 4));
    await seedOAuthAccount(userId);
    caller.userId = userId;

    const res = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(res.status).toBe(200);
    const remaining = db.select({ providerId: accounts.providerId }).from(accounts)
      .where(eq(accounts.userId, userId)).all();
    expect(remaining).toEqual([{ providerId: 'credential' }]);
  });

  it('refuses to unlink when the password is not on the credential account', async () => {
    const userId = await seedUser('legacy@example.com', bcrypt.hashSync(PASSWORD, 4));
    await seedOAuthAccount(userId);
    caller.userId = userId;

    const res = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(res.status).toBe(400);
    expect(db.select().from(accounts).where(eq(accounts.providerId, 'dex')).all()).toHaveLength(1);
  });

  it('refuses to unlink when the user has no username to sign in with', async () => {
    const userId = await seedUser('self@example.com', null, null);
    await seedCredentialAccount(userId, bcrypt.hashSync(PASSWORD, 4));
    await seedOAuthAccount(userId);
    caller.userId = userId;

    const res = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(res.status).toBe(400);
    expect(db.select().from(accounts).where(eq(accounts.providerId, 'dex')).all()).toHaveLength(1);
  });

  it('refuses to unlink the only login method', async () => {
    const userId = await seedUser('oauth@example.com');
    await seedOAuthAccount(userId);
    await seedCredentialAccount(userId, null);
    caller.userId = userId;

    const res = await unlinkOAuth(post('/api/user/unlink-oauth'));
    expect(res.status).toBe(400);
    expect(db.select().from(accounts).where(eq(accounts.providerId, 'dex')).all()).toHaveLength(1);
  });
});

describe('updateUserProfile', () => {
  it('gives a user with a password a username the login page can find', async () => {
    // Stored by older releases, which copied the email as it was.
    const userId = await seedUser('carol+cpm@example.com', 'hash', 'carol+cpm@example.com');
    await seedCredentialAccount(userId, 'hash');
    expect(await getPasswordSignInUsername(userId)).toBeNull();

    const updated = await updateUserProfile(userId, { name: 'Carol' });

    expect(updated?.username).toBe('carol-cpm@example.com');
    expect(signInColumns(userId)).toEqual({ username: 'carol-cpm@example.com', displayUsername: 'Carol' });
    expect(await getPasswordSignInUsername(userId)).toBe('carol-cpm@example.com');
  });

  it('makes the username from the new email', async () => {
    const userId = await seedUser('carol+cpm@example.com', 'hash', 'carol+cpm@example.com');
    await seedCredentialAccount(userId, 'hash');

    await updateUserProfile(userId, { email: 'carol@example.com' });

    expect(await getPasswordSignInUsername(userId)).toBe('carol@example.com');
  });

  it('does not fold a look-alike character in a new email into another address', async () => {
    await seedUser('kate@example.com');
    const userId = await seedUser('erin+x@example.com', 'hash', 'erin+x@example.com');
    await seedCredentialAccount(userId, 'hash');

    await updateUserProfile(userId, { email: '\u212Aate@example.com' });

    expect(signInColumns(userId)?.username).toBe('-ate@example.com');
  });

  it('keeps a username that works and leaves users without a password alone', async () => {
    const working = await seedUser('alice@example.com', 'hash', 'alice@example.com');
    await seedCredentialAccount(working, 'hash');
    const oauthOnly = await seedUser('dex+tag@example.com', null, null);
    await seedOAuthAccount(oauthOnly);

    await updateUserProfile(working, { email: 'alice.new@example.com' });
    await updateUserProfile(oauthOnly, { name: 'Dex' });

    expect(signInColumns(working)?.username).toBe('alice@example.com');
    expect(signInColumns(oauthOnly)?.username).toBeNull();
  });
});

describe('repairLoginUsernames', () => {
  it('gives every user with a password a username the login page can find', async () => {
    const plus = await seedUser('carol+cpm@example.com', 'hash', 'carol+cpm@example.com');
    await seedCredentialAccount(plus, 'hash');
    const upper = await seedUser('bob@example.com', 'hash', 'Bob');
    await seedCredentialAccount(upper, 'hash');
    const selfRegistered = await seedUser('self+x@example.com', null, null);
    await seedCredentialAccount(selfRegistered, 'hash');
    // Both derive carol-cpm@example.com; the second one is numbered.
    const twin = await seedUser('carol%cpm@example.com', 'hash', 'carol%cpm@example.com');
    await seedCredentialAccount(twin, 'hash');

    const repaired = await repairLoginUsernames();

    expect(repaired).toEqual([
      { userId: plus, username: 'carol-cpm@example.com' },
      { userId: upper, username: 'bob@example.com' },
      { userId: selfRegistered, username: 'self-x@example.com' },
      { userId: twin, username: 'carol-cpm-2@example.com' },
    ]);
    for (const { userId, username } of repaired) {
      expect(await getPasswordSignInStatus(userId)).toEqual({ username, blocker: null });
    }
    expect(await repairLoginUsernames()).toEqual([]);
  });

  it('leaves working usernames and users without a password on the credential account alone', async () => {
    const working = await seedUser('alice@example.com', 'hash', 'alice');
    await seedCredentialAccount(working, 'hash');
    const oauthOnly = await seedUser('dex+tag@example.com', null, 'dex+tag@example.com');
    await seedOAuthAccount(oauthOnly);
    const legacy = await seedUser('legacy+x@example.com', 'hash', 'legacy+x@example.com');
    const emptyCredential = await seedUser('empty+x@example.com', null, null);
    await seedCredentialAccount(emptyCredential, null);

    expect(await repairLoginUsernames()).toEqual([]);

    expect(signInColumns(working)?.username).toBe('alice');
    expect(signInColumns(oauthOnly)?.username).toBe('dex+tag@example.com');
    expect(signInColumns(legacy)?.username).toBe('legacy+x@example.com');
    expect(signInColumns(emptyCredential)?.username).toBeNull();
  });

  it('skips a user no username can be made for', async () => {
    await takeEveryDexTagUsername();
    const userId = await seedUser('dex+tag@example.com', 'hash', 'dex+tag@example.com');
    await seedCredentialAccount(userId, 'hash');

    expect(await repairLoginUsernames()).toEqual([]);
    expect(await getPasswordSignInStatus(userId)).toEqual({ username: null, blocker: 'no-username' });
  });
});
