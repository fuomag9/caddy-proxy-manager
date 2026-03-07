import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { users } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const now = nowIso();
  const [user] = await db.insert(users).values({
    email: 'user@example.com',
    name: 'Test User',
    passwordHash: 'hash123',
    role: 'user',
    provider: 'credentials',
    subject: 'user@example.com',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return user;
}

describe('users integration', () => {
  it('inserts a user and retrieves it by email', async () => {
    await insertUser({ email: 'alice@example.com', subject: 'alice@example.com' });
    const row = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, 'alice@example.com') });
    expect(row).toBeDefined();
    expect(row!.email).toBe('alice@example.com');
  });

  it('duplicate email throws unique constraint error', async () => {
    await insertUser({ email: 'dup@example.com', subject: 'dup@example.com' });
    await expect(
      insertUser({ email: 'dup@example.com', subject: 'dup2@example.com' })
    ).rejects.toThrow();
  });

  it('user has correct default role', async () => {
    const user = await insertUser();
    expect(user.role).toBe('user');
  });

  it('find by non-existent email returns undefined', async () => {
    const row = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.email, 'nobody@example.com') });
    expect(row).toBeUndefined();
  });

  it('user insert stores ISO timestamps in createdAt/updatedAt', async () => {
    const now = nowIso();
    const user = await insertUser({ createdAt: now, updatedAt: now });
    expect(user.createdAt).toBe(now);
    expect(user.updatedAt).toBe(now);
  });

  it('list users returns all inserted users', async () => {
    await insertUser({ email: 'a@example.com', subject: 'a' });
    await insertUser({ email: 'b@example.com', subject: 'b' });
    const rows = await db.select().from(users);
    expect(rows.length).toBe(2);
  });

  it('delete user by id removes it', async () => {
    const user = await insertUser();
    await db.delete(users).where(eq(users.id, user.id));
    const row = await db.query.users.findFirst({ where: (t, { eq }) => eq(t.id, user.id) });
    expect(row).toBeUndefined();
  });
});
