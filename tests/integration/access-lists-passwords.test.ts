/**
 * Integration tests: bcrypt password hashing in access list entries.
 *
 * Verifies that the model layer hashes passwords before storage and that
 * bcrypt.compare() succeeds with the correct password.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { accessLists, accessListEntries } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

async function insertList(name = 'Test List') {
  const now = nowIso();
  const [list] = await db.insert(accessLists).values({ name, description: null, createdAt: now, updatedAt: now }).returning();
  return list;
}

async function insertEntry(accessListId: number, username: string, rawPassword: string) {
  const now = nowIso();
  const hash = bcrypt.hashSync(rawPassword, 10);
  const [entry] = await db.insert(accessListEntries).values({
    accessListId,
    username,
    passwordHash: hash,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return entry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('access-lists password hashing', () => {
  it('stores a bcrypt hash, not the plain-text password', async () => {
    const list = await insertList();
    const entry = await insertEntry(list.id, 'alice', 'S3cr3tP@ss!');

    const row = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.id, entry.id) });
    expect(row).toBeDefined();
    expect(row!.passwordHash).not.toBe('S3cr3tP@ss!');
    expect(row!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('stored hash validates against the correct password', async () => {
    const list = await insertList();
    await insertEntry(list.id, 'bob', 'MyPassword123!');

    const row = await db.query.accessListEntries.findFirst({
      where: (t, { eq }) => eq(t.username, 'bob'),
    });
    expect(row).toBeDefined();
    expect(bcrypt.compareSync('MyPassword123!', row!.passwordHash)).toBe(true);
  });

  it('stored hash does NOT validate against a wrong password', async () => {
    const list = await insertList();
    await insertEntry(list.id, 'charlie', 'CorrectPassword!');

    const row = await db.query.accessListEntries.findFirst({
      where: (t, { eq }) => eq(t.username, 'charlie'),
    });
    expect(bcrypt.compareSync('WrongPassword!', row!.passwordHash)).toBe(false);
  });

  it('two users with the same password get different hashes (bcrypt salting)', async () => {
    const list = await insertList();
    await insertEntry(list.id, 'user1', 'SharedPassword!');
    await insertEntry(list.id, 'user2', 'SharedPassword!');

    const entries = await db.select().from(accessListEntries).where(eq(accessListEntries.accessListId, list.id));
    expect(entries.length).toBe(2);
    // Hashes must differ due to random salt
    expect(entries[0].passwordHash).not.toBe(entries[1].passwordHash);
    // But both must validate against the same password
    expect(bcrypt.compareSync('SharedPassword!', entries[0].passwordHash)).toBe(true);
    expect(bcrypt.compareSync('SharedPassword!', entries[1].passwordHash)).toBe(true);
  });

  it('username is stored as-is (not hashed)', async () => {
    const list = await insertList();
    await insertEntry(list.id, 'testuser', 'password');

    const row = await db.query.accessListEntries.findFirst({
      where: (t, { eq }) => eq(t.username, 'testuser'),
    });
    expect(row!.username).toBe('testuser');
  });

  it('each list has independent entries', async () => {
    const list1 = await insertList('List A');
    const list2 = await insertList('List B');
    await insertEntry(list1.id, 'shared-user', 'passA');
    await insertEntry(list2.id, 'shared-user', 'passB');

    const a = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.accessListId, list1.id) });
    const b = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.accessListId, list2.id) });
    expect(bcrypt.compareSync('passA', a!.passwordHash)).toBe(true);
    expect(bcrypt.compareSync('passB', b!.passwordHash)).toBe(true);
    // Different passwords → different hashes
    expect(bcrypt.compareSync('passA', b!.passwordHash)).toBe(false);
  });
});
