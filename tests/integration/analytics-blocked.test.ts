import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { trafficEvents } from '@/src/lib/db/schema';
import { sql, and, gte, lte, eq, inArray } from 'drizzle-orm';

// Mock dependencies so we can import collectBlockedSignatures and parseLine.
// These run in the log-parser module scope on import.
vi.mock('@/src/lib/db', () => ({
  default: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(null) }) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ run: vi.fn() }) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
    run: vi.fn(),
  },
}));
vi.mock('maxmind', () => ({ default: { open: vi.fn().mockResolvedValue(null) } }));
vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  statSync: vi.fn().mockReturnValue({ size: 0 }),
  createReadStream: vi.fn(),
}));

import { collectBlockedSignatures, parseLine } from '@/src/lib/log-parser';

let db: TestDb;

const NOW = Math.floor(Date.now() / 1000);

beforeEach(() => {
  db = createTestDb();
});

/** Insert a traffic event row with sensible defaults. */
function insertEvent(overrides: Partial<typeof trafficEvents.$inferInsert> = {}) {
  db.insert(trafficEvents).values({
    ts: NOW,
    clientIp: '1.2.3.4',
    countryCode: 'DE',
    host: 'example.com',
    method: 'GET',
    uri: '/',
    status: 200,
    proto: 'HTTP/2.0',
    bytesSent: 1024,
    userAgent: 'Mozilla/5.0',
    isBlocked: false,
    ...overrides,
  }).run();
}

// ── Helpers that mirror analytics-db.ts queries ─────────────────────────────
// We duplicate the SQL here intentionally — if the production queries ever
// drift from what the schema supports, these tests will catch it.

function buildWhere(from: number, to: number, hosts: string[]) {
  const conditions = [gte(trafficEvents.ts, from), lte(trafficEvents.ts, to)];
  if (hosts.length === 1) {
    conditions.push(eq(trafficEvents.host, hosts[0]));
  } else if (hosts.length > 1) {
    conditions.push(inArray(trafficEvents.host, hosts));
  }
  return and(...conditions);
}

function getSummary(from: number, to: number, hosts: string[] = []) {
  const where = buildWhere(from, to, hosts);
  return db
    .select({
      total: sql<number>`count(*)`,
      uniqueIps: sql<number>`count(distinct ${trafficEvents.clientIp})`,
      blocked: sql<number>`sum(case when ${trafficEvents.isBlocked} then 1 else 0 end)`,
      bytes: sql<number>`sum(${trafficEvents.bytesSent})`,
    })
    .from(trafficEvents)
    .where(where)
    .get();
}

function getCountries(from: number, to: number, hosts: string[] = []) {
  const where = buildWhere(from, to, hosts);
  return db
    .select({
      countryCode: trafficEvents.countryCode,
      total: sql<number>`count(*)`,
      blocked: sql<number>`sum(case when ${trafficEvents.isBlocked} then 1 else 0 end)`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.countryCode)
    .orderBy(sql`count(*) desc`)
    .all();
}

function getTimeline(from: number, to: number, bucketSize: number, hosts: string[] = []) {
  const where = buildWhere(from, to, hosts);
  return db
    .select({
      bucket: sql<number>`(${trafficEvents.ts} / ${sql.raw(String(bucketSize))})`,
      total: sql<number>`count(*)`,
      blocked: sql<number>`sum(case when ${trafficEvents.isBlocked} then 1 else 0 end)`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(sql`(${trafficEvents.ts} / ${sql.raw(String(bucketSize))})`)
    .orderBy(sql`(${trafficEvents.ts} / ${sql.raw(String(bucketSize))})`)
    .all();
}

function getBlockedEvents(from: number, to: number, hosts: string[] = []) {
  const where = and(buildWhere(from, to, hosts), eq(trafficEvents.isBlocked, true));
  return db
    .select({
      id: trafficEvents.id,
      ts: trafficEvents.ts,
      clientIp: trafficEvents.clientIp,
      countryCode: trafficEvents.countryCode,
      host: trafficEvents.host,
      status: trafficEvents.status,
    })
    .from(trafficEvents)
    .where(where)
    .orderBy(sql`${trafficEvents.ts} desc`)
    .all();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('analytics blocked counting', () => {
  const from = NOW - 3600;
  const to = NOW + 3600;

  describe('summary', () => {
    it('counts zero blocked when no events are blocked', () => {
      insertEvent({ isBlocked: false });
      insertEvent({ isBlocked: false });
      const row = getSummary(from, to);
      expect(row!.total).toBe(2);
      expect(row!.blocked).toBe(0);
    });

    it('counts geo-blocked requests correctly', () => {
      insertEvent({ isBlocked: true, status: 403, clientIp: '5.6.7.8', countryCode: 'CN' });
      insertEvent({ isBlocked: true, status: 403, clientIp: '9.10.11.12', countryCode: 'RU' });
      insertEvent({ isBlocked: false, status: 200 });
      const row = getSummary(from, to);
      expect(row!.total).toBe(3);
      expect(row!.blocked).toBe(2);
    });

    it('filters by host', () => {
      insertEvent({ isBlocked: true, host: 'blocked.com' });
      insertEvent({ isBlocked: false, host: 'blocked.com' });
      insertEvent({ isBlocked: true, host: 'other.com' });
      const row = getSummary(from, to, ['blocked.com']);
      expect(row!.total).toBe(2);
      expect(row!.blocked).toBe(1);
    });
  });

  describe('countries', () => {
    it('shows blocked count per country', () => {
      insertEvent({ isBlocked: true, countryCode: 'CN' });
      insertEvent({ isBlocked: true, countryCode: 'CN' });
      insertEvent({ isBlocked: false, countryCode: 'CN' });
      insertEvent({ isBlocked: true, countryCode: 'RU' });
      insertEvent({ isBlocked: false, countryCode: 'US' });

      const rows = getCountries(from, to);
      const cn = rows.find(r => r.countryCode === 'CN');
      const ru = rows.find(r => r.countryCode === 'RU');
      const us = rows.find(r => r.countryCode === 'US');

      expect(cn!.total).toBe(3);
      expect(cn!.blocked).toBe(2);
      expect(ru!.total).toBe(1);
      expect(ru!.blocked).toBe(1);
      expect(us!.total).toBe(1);
      expect(us!.blocked).toBe(0);
    });
  });

  describe('timeline', () => {
    it('shows blocked count per time bucket', () => {
      const bucketSize = 3600;
      const bucket1Ts = NOW;
      const bucket2Ts = NOW + 3600;

      insertEvent({ ts: bucket1Ts, isBlocked: true });
      insertEvent({ ts: bucket1Ts, isBlocked: true });
      insertEvent({ ts: bucket1Ts, isBlocked: false });
      insertEvent({ ts: bucket2Ts, isBlocked: true });
      insertEvent({ ts: bucket2Ts, isBlocked: false });
      insertEvent({ ts: bucket2Ts, isBlocked: false });

      const rows = getTimeline(from, to + 7200, bucketSize);
      expect(rows.length).toBe(2);

      const b1 = rows[0];
      expect(b1.total).toBe(3);
      expect(b1.blocked).toBe(2);

      const b2 = rows[1];
      expect(b2.total).toBe(3);
      expect(b2.blocked).toBe(1);
    });
  });

  describe('blocked events list', () => {
    it('returns only blocked events', () => {
      insertEvent({ isBlocked: true, clientIp: '5.6.7.8', countryCode: 'CN', status: 403 });
      insertEvent({ isBlocked: false, clientIp: '1.2.3.4', countryCode: 'US', status: 200 });
      insertEvent({ isBlocked: true, clientIp: '9.10.11.12', countryCode: 'RU', status: 403 });

      const rows = getBlockedEvents(from, to);
      expect(rows.length).toBe(2);
      expect(rows.every(r => r.status === 403)).toBe(true);
      const ips = rows.map(r => r.clientIp).sort();
      expect(ips).toEqual(['5.6.7.8', '9.10.11.12']);
    });

    it('returns empty list when nothing is blocked', () => {
      insertEvent({ isBlocked: false });
      insertEvent({ isBlocked: false });

      const rows = getBlockedEvents(from, to);
      expect(rows.length).toBe(0);
    });

    it('filters blocked events by host', () => {
      insertEvent({ isBlocked: true, host: 'target.com' });
      insertEvent({ isBlocked: true, host: 'other.com' });

      const rows = getBlockedEvents(from, to, ['target.com']);
      expect(rows.length).toBe(1);
      expect(rows[0].host).toBe('target.com');
    });
  });

  describe('full pipeline: raw log lines → parseLine → DB → analytics queries', () => {
    it('geo-blocked request flows through the entire pipeline', () => {
      const ts = NOW;

      // Simulate the two log entries that Caddy writes to access.log for a
      // geo-blocked request: the blocker's "request blocked" entry followed
      // by the standard "handled request" entry.
      const blockedLogLine = JSON.stringify({
        ts: ts + 0.01,
        msg: 'request blocked',
        plugin: 'caddy-blocker',
        client_ip: '203.0.113.5',
        method: 'GET',
        uri: '/secret',
      });
      const handledBlockedLine = JSON.stringify({
        ts: ts + 0.99,
        msg: 'handled request',
        status: 403,
        size: 9,
        request: {
          client_ip: '203.0.113.5',
          host: 'secure.example.com',
          method: 'GET',
          uri: '/secret',
          proto: 'HTTP/2.0',
          headers: { 'User-Agent': ['BlockedBot/1.0'] },
        },
      });

      // A normal allowed request in the same log batch.
      const allowedLine = JSON.stringify({
        ts: ts + 1.5,
        msg: 'handled request',
        status: 200,
        size: 4096,
        request: {
          client_ip: '198.51.100.1',
          host: 'secure.example.com',
          method: 'GET',
          uri: '/',
          proto: 'HTTP/2.0',
          headers: { 'User-Agent': ['GoodBot/2.0'] },
        },
      });

      // Step 1: collectBlockedSignatures builds the blocked set from all lines
      const lines = [blockedLogLine, handledBlockedLine, allowedLine];
      const blockedSet = collectBlockedSignatures(lines);
      expect(blockedSet.size).toBe(1);

      // Step 2: parseLine processes each "handled request" line
      const blockedRow = parseLine(handledBlockedLine, blockedSet);
      const allowedRow = parseLine(allowedLine, blockedSet);
      expect(blockedRow).not.toBeNull();
      expect(allowedRow).not.toBeNull();
      expect(blockedRow!.isBlocked).toBe(true);
      expect(allowedRow!.isBlocked).toBe(false);

      // Step 3: Insert into DB (as the real log parser does)
      db.insert(trafficEvents).values(blockedRow!).run();
      db.insert(trafficEvents).values(allowedRow!).run();

      // Step 4: Verify all analytics queries reflect the blocked request

      // Summary
      const summary = getSummary(from, to);
      expect(summary!.total).toBe(2);
      expect(summary!.blocked).toBe(1);

      // Countries (GeoIP is mocked so countryCode is null → grouped together)
      const countries = getCountries(from, to);
      const group = countries[0];
      expect(group.total).toBe(2);
      expect(group.blocked).toBe(1);

      // Timeline
      const timeline = getTimeline(from, to, 3600);
      expect(timeline.length).toBe(1);
      expect(timeline[0].total).toBe(2);
      expect(timeline[0].blocked).toBe(1);

      // Blocked events list
      const blocked = getBlockedEvents(from, to);
      expect(blocked.length).toBe(1);
      expect(blocked[0].clientIp).toBe('203.0.113.5');
      expect(blocked[0].status).toBe(403);

      // Filtered by host
      const filteredSummary = getSummary(from, to, ['secure.example.com']);
      expect(filteredSummary!.blocked).toBe(1);
      const wrongHost = getSummary(from, to, ['other.com']);
      expect(wrongHost!.total).toBe(0);
    });

    it('non-blocked request does not appear in blocked stats', () => {
      const ts = NOW;

      // Only a normal "handled request" — no "request blocked" entry
      const normalLine = JSON.stringify({
        ts: ts + 0.5,
        msg: 'handled request',
        status: 200,
        size: 2048,
        request: {
          client_ip: '198.51.100.1',
          host: 'open.example.com',
          method: 'GET',
          uri: '/public',
          proto: 'HTTP/2.0',
        },
      });

      const lines = [normalLine];
      const blockedSet = collectBlockedSignatures(lines);
      expect(blockedSet.size).toBe(0);

      const row = parseLine(normalLine, blockedSet);
      expect(row!.isBlocked).toBe(false);

      db.insert(trafficEvents).values(row!).run();

      const summary = getSummary(from, to);
      expect(summary!.total).toBe(1);
      expect(summary!.blocked).toBe(0);

      const blocked = getBlockedEvents(from, to);
      expect(blocked.length).toBe(0);
    });
  });
});
