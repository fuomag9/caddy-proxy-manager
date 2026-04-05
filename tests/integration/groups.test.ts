import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { groups, groupMembers, users } from '@/src/lib/db/schema';
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
    email: `user${Math.random().toString(36).slice(2)}@localhost`,
    name: 'Test User',
    role: 'user',
    provider: 'credentials',
    subject: `test-${Date.now()}`,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return user;
}

async function insertGroup(overrides: Partial<typeof groups.$inferInsert> = {}) {
  const now = nowIso();
  const [group] = await db.insert(groups).values({
    name: `Group ${Date.now()}`,
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return group;
}

describe('groups integration', () => {
  it('creates a group and stores it', async () => {
    const group = await insertGroup({ name: 'Developers' });
    const row = await db.query.groups.findFirst({ where: (t, { eq }) => eq(t.id, group.id) });
    expect(row).toBeDefined();
    expect(row!.name).toBe('Developers');
  });

  it('enforces unique group names', async () => {
    await insertGroup({ name: 'UniqueGroup' });
    await expect(insertGroup({ name: 'UniqueGroup' })).rejects.toThrow();
  });

  it('adds members to a group', async () => {
    const group = await insertGroup({ name: 'Team' });
    const user = await insertUser();
    const now = nowIso();

    await db.insert(groupMembers).values({
      groupId: group.id,
      userId: user.id,
      createdAt: now,
    });

    const members = await db.query.groupMembers.findMany({
      where: (t, { eq }) => eq(t.groupId, group.id),
    });
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(user.id);
  });

  it('prevents duplicate memberships', async () => {
    const group = await insertGroup();
    const user = await insertUser();
    const now = nowIso();

    await db.insert(groupMembers).values({ groupId: group.id, userId: user.id, createdAt: now });
    await expect(
      db.insert(groupMembers).values({ groupId: group.id, userId: user.id, createdAt: now })
    ).rejects.toThrow();
  });

  it('cascades group deletion to members', async () => {
    const group = await insertGroup();
    const user = await insertUser();
    const now = nowIso();

    await db.insert(groupMembers).values({ groupId: group.id, userId: user.id, createdAt: now });
    await db.delete(groups).where(eq(groups.id, group.id));

    const members = await db.query.groupMembers.findMany({
      where: (t, { eq }) => eq(t.groupId, group.id),
    });
    expect(members).toHaveLength(0);
  });

  it('cascades user deletion to memberships', async () => {
    const group = await insertGroup();
    const user = await insertUser();
    const now = nowIso();

    await db.insert(groupMembers).values({ groupId: group.id, userId: user.id, createdAt: now });
    await db.delete(users).where(eq(users.id, user.id));

    const members = await db.query.groupMembers.findMany({
      where: (t, { eq }) => eq(t.groupId, group.id),
    });
    expect(members).toHaveLength(0);
  });

  it('supports multiple groups per user', async () => {
    const group1 = await insertGroup({ name: 'Group A' });
    const group2 = await insertGroup({ name: 'Group B' });
    const user = await insertUser();
    const now = nowIso();

    await db.insert(groupMembers).values([
      { groupId: group1.id, userId: user.id, createdAt: now },
      { groupId: group2.id, userId: user.id, createdAt: now },
    ]);

    const memberships = await db.query.groupMembers.findMany({
      where: (t, { eq }) => eq(t.userId, user.id),
    });
    expect(memberships).toHaveLength(2);
  });
});
