import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { auditEvents, users } from '@/src/lib/db/schema';
import { desc, eq, like } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function insertEvent(overrides: Partial<typeof auditEvents.$inferInsert> = {}) {
  const [event] = await db.insert(auditEvents).values({
    action: 'create',
    entityType: 'proxy_host',
    entityId: 1,
    summary: 'Created proxy host example.com',
    data: null,
    userId: null,
    createdAt: nowIso(),
    ...overrides,
  }).returning();
  return event;
}

describe('audit-log integration', () => {
  it('inserts audit event and retrieves it', async () => {
    const event = await insertEvent({ action: 'update', entityType: 'certificate', summary: 'Updated cert' });
    const row = await db.query.auditEvents.findFirst({ where: (t, { eq }) => eq(t.id, event.id) });
    expect(row).toBeDefined();
    expect(row!.action).toBe('update');
    expect(row!.entityType).toBe('certificate');
    expect(row!.summary).toBe('Updated cert');
  });

  it('multiple events ordered by createdAt descending', async () => {
    await insertEvent({ summary: 'First', createdAt: nowIso(0) });
    await insertEvent({ summary: 'Second', createdAt: nowIso(1000) });
    await insertEvent({ summary: 'Third', createdAt: nowIso(2000) });

    const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt));
    expect(rows[0].summary).toBe('Third');
    expect(rows[1].summary).toBe('Second');
    expect(rows[2].summary).toBe('First');
  });

  it('event data JSON is stored and retrieved correctly', async () => {
    const payload = { key: 'value', nested: { num: 42 } };
    const event = await insertEvent({ data: JSON.stringify(payload) });
    const row = await db.query.auditEvents.findFirst({ where: (t, { eq }) => eq(t.id, event.id) });
    expect(JSON.parse(row!.data!)).toEqual(payload);
  });

  it('filter by action returns correct results', async () => {
    await insertEvent({ action: 'create', summary: 'create event' });
    await insertEvent({ action: 'delete', summary: 'delete event' });
    await insertEvent({ action: 'create', summary: 'another create event' });

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.action, 'create'));
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.action === 'create')).toBe(true);
  });

  it('filter by entityType returns correct results', async () => {
    await insertEvent({ entityType: 'proxy_host' });
    await insertEvent({ entityType: 'certificate' });
    await insertEvent({ entityType: 'proxy_host' });

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.entityType, 'certificate'));
    expect(rows.length).toBe(1);
    expect(rows[0].entityType).toBe('certificate');
  });

  it('search by summary text works', async () => {
    await insertEvent({ summary: 'Created host foo.com' });
    await insertEvent({ summary: 'Deleted access list Bar' });
    await insertEvent({ summary: 'Updated host baz.com' });

    const rows = await db.select().from(auditEvents).where(like(auditEvents.summary, '%host%'));
    expect(rows.length).toBe(2);
  });

  it('event with userId stores reference correctly', async () => {
    // Insert a user first (needed for FK)
    const now = nowIso();
    const [user] = await db.insert(users).values({
      email: 'admin@test.com',
      name: 'Admin',
      passwordHash: 'hash',
      role: 'admin',
      provider: 'credentials',
      subject: 'admin@test.com',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }).returning();

    const event = await insertEvent({ userId: user.id });
    const row = await db.query.auditEvents.findFirst({ where: (t, { eq }) => eq(t.id, event.id) });
    expect(row!.userId).toBe(user.id);
  });
});
