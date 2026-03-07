import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { accessLists, accessListEntries } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertAccessList(overrides: Partial<typeof accessLists.$inferInsert> = {}) {
  const now = nowIso();
  const [list] = await db.insert(accessLists).values({
    name: 'Test List',
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return list;
}

async function insertEntry(accessListId: number, overrides: Partial<typeof accessListEntries.$inferInsert> = {}) {
  const now = nowIso();
  const [entry] = await db.insert(accessListEntries).values({
    accessListId,
    username: 'testuser',
    passwordHash: '$2b$10$hashedpassword',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return entry;
}

describe('access-lists integration', () => {
  it('creates an access list and stores it', async () => {
    const list = await insertAccessList({ name: 'Private Area' });
    const row = await db.query.accessLists.findFirst({ where: (t, { eq }) => eq(t.id, list.id) });
    expect(row).toBeDefined();
    expect(row!.name).toBe('Private Area');
  });

  it('creates access list entry with username and hash', async () => {
    const list = await insertAccessList();
    const entry = await insertEntry(list.id, { username: 'alice', passwordHash: '$2b$10$abc' });
    const row = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.id, entry.id) });
    expect(row!.username).toBe('alice');
    expect(row!.passwordHash).toBe('$2b$10$abc');
  });

  it('queries entries for a list and returns correct count', async () => {
    const list = await insertAccessList();
    await insertEntry(list.id, { username: 'user1' });
    await insertEntry(list.id, { username: 'user2' });
    await insertEntry(list.id, { username: 'user3' });

    const entries = await db.select().from(accessListEntries).where(eq(accessListEntries.accessListId, list.id));
    expect(entries.length).toBe(3);
  });

  it('deletes an entry and it is removed', async () => {
    const list = await insertAccessList();
    const entry = await insertEntry(list.id);
    await db.delete(accessListEntries).where(eq(accessListEntries.id, entry.id));
    const row = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.id, entry.id) });
    expect(row).toBeUndefined();
  });

  it('deletes a list and cascades to entries', async () => {
    const list = await insertAccessList();
    await insertEntry(list.id, { username: 'user1' });
    await insertEntry(list.id, { username: 'user2' });

    await db.delete(accessLists).where(eq(accessLists.id, list.id));

    const listRow = await db.query.accessLists.findFirst({ where: (t, { eq }) => eq(t.id, list.id) });
    expect(listRow).toBeUndefined();

    const entryRows = await db.select().from(accessListEntries).where(eq(accessListEntries.accessListId, list.id));
    expect(entryRows.length).toBe(0);
  });

  it('entries for different lists do not mix', async () => {
    const list1 = await insertAccessList({ name: 'List 1' });
    const list2 = await insertAccessList({ name: 'List 2' });
    await insertEntry(list1.id, { username: 'user-in-list1' });
    await insertEntry(list2.id, { username: 'user-in-list2' });

    const list1Entries = await db.select().from(accessListEntries).where(eq(accessListEntries.accessListId, list1.id));
    expect(list1Entries.length).toBe(1);
    expect(list1Entries[0].username).toBe('user-in-list1');
  });
});
