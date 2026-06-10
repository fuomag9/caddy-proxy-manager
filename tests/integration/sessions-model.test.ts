/**
 * Integration tests for the session-management model (src/lib/models/sessions.ts)
 * backing the profile "Active sessions" view: list active sessions, revoke one
 * (ownership-scoped), and revoke all others.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { users, sessions } from '../../src/lib/db/schema';

let db: TestDb;

vi.mock('../../src/lib/db', async () => {
  return {
    get default() { return db; },
    get sqlite() { return undefined; },
  };
});

import { listUserSessions, revokeUserSession, revokeOtherUserSessions } from '../../src/lib/models/sessions';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function seedUser(id: number, email: string) {
  await db.insert(users).values({
    id, email, name: email, role: 'user', provider: 'credentials', subject: email,
    status: 'active', createdAt: iso(0), updatedAt: iso(0),
  });
}

async function seedSession(opts: { id: number; userId: number; createdMsAgo: number; expiresInMs: number; ip?: string; ua?: string }) {
  await db.insert(sessions).values({
    id: opts.id,
    userId: opts.userId,
    token: `tok-${opts.id}`,
    expiresAt: iso(opts.expiresInMs),
    ipAddress: opts.ip ?? null,
    userAgent: opts.ua ?? null,
    createdAt: iso(-opts.createdMsAgo),
    updatedAt: iso(-opts.createdMsAgo),
  });
}

beforeEach(async () => {
  db = createTestDb();
  await seedUser(1, 'alice@example.com');
  await seedUser(2, 'bob@example.com');
});

describe('sessions model', () => {
  it('lists only the user\'s active sessions, newest first, excluding expired', async () => {
    await seedSession({ id: 10, userId: 1, createdMsAgo: 2 * HOUR, expiresInMs: 7 * DAY, ua: 'Mozilla/5.0 (Macintosh) Chrome/120' });
    await seedSession({ id: 11, userId: 1, createdMsAgo: 1 * HOUR, expiresInMs: 7 * DAY }); // newer
    await seedSession({ id: 12, userId: 1, createdMsAgo: 3 * HOUR, expiresInMs: -HOUR });   // expired
    await seedSession({ id: 20, userId: 2, createdMsAgo: 1 * HOUR, expiresInMs: 7 * DAY }); // other user

    const list = await listUserSessions(1);
    expect(list.map((s) => s.id)).toEqual([11, 10]); // active only, newest first; no 12, no 20
    expect(list[1].userAgent).toContain('Chrome');
  });

  it('revokes a single session only when it belongs to the user', async () => {
    await seedSession({ id: 10, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });
    await seedSession({ id: 20, userId: 2, createdMsAgo: HOUR, expiresInMs: 7 * DAY });

    // Cannot revoke another user's session.
    expect(await revokeUserSession(1, 20)).toBe(false);
    expect((await listUserSessions(2)).map((s) => s.id)).toEqual([20]);

    // Can revoke own.
    expect(await revokeUserSession(1, 10)).toBe(true);
    expect(await listUserSessions(1)).toEqual([]);

    // Revoking a non-existent session returns false.
    expect(await revokeUserSession(1, 9999)).toBe(false);
  });

  it('revokes all other sessions, preserving the excepted (current) one', async () => {
    await seedSession({ id: 10, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });
    await seedSession({ id: 11, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });
    await seedSession({ id: 12, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });
    await seedSession({ id: 20, userId: 2, createdMsAgo: HOUR, expiresInMs: 7 * DAY });

    const revoked = await revokeOtherUserSessions(1, 11);
    expect(revoked).toBe(2); // 10 and 12
    expect((await listUserSessions(1)).map((s) => s.id)).toEqual([11]);
    // Other user's session untouched.
    expect((await listUserSessions(2)).map((s) => s.id)).toEqual([20]);
  });

  it('revokes every session when there is no current session to preserve (null)', async () => {
    await seedSession({ id: 10, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });
    await seedSession({ id: 11, userId: 1, createdMsAgo: HOUR, expiresInMs: 7 * DAY });

    const revoked = await revokeOtherUserSessions(1, null);
    expect(revoked).toBe(2);
    expect(await listUserSessions(1)).toEqual([]);
  });
});
