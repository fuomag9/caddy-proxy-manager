/**
 * The access-list model hashes entry passwords with async bcrypt, so creating
 * a list with many users does not block the event loop (and with it every
 * forward-auth check) for the whole batch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestDb, type TestDb } from '../helpers/db';
import { users } from '@/src/lib/db/schema';

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

import { addAccessListEntry, createAccessList } from '@/src/lib/models/access-lists';

beforeEach(async () => {
  db = createTestDb();
  const now = new Date().toISOString();
  // The acting admin the lists are created by.
  await db.insert(users).values({
    id: 1, email: 'admin@example.com', role: 'admin', status: 'active', createdAt: now, updatedAt: now,
  });
  vi.spyOn(bcrypt, 'hashSync');
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function storedHash(username: string) {
  const row = await db.query.accessListEntries.findFirst({ where: (t, { eq }) => eq(t.username, username) });
  return row!.passwordHash;
}

describe('access-list password hashing', () => {
  it('hashes every entry of a new list asynchronously', async () => {
    const users = Array.from({ length: 5 }, (_, i) => ({ username: `user${i}`, password: `Password-${i}!` }));
    const list = await createAccessList({ name: 'Bulk', users }, 1);

    expect(list.entries.map((e) => e.username)).toEqual(users.map((u) => u.username));
    expect(bcrypt.hashSync).not.toHaveBeenCalled();
    for (const { username, password } of users) {
      const hash = await storedHash(username);
      expect(await bcrypt.compare(password, hash)).toBe(true);
      // Each entry is matched to its own password, not a neighbour's.
      expect(await bcrypt.compare(`${password}x`, hash)).toBe(false);
    }
  });

  it('hashes an added entry asynchronously', async () => {
    const list = await createAccessList({ name: 'Single' }, 1);
    await addAccessListEntry(list.id, { username: 'carol', password: 'Carol-Pass-1!' }, 1);

    expect(bcrypt.hashSync).not.toHaveBeenCalled();
    expect(await bcrypt.compare('Carol-Pass-1!', await storedHash('carol'))).toBe(true);
  });
});
