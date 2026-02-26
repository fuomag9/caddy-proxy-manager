import { sql, and, gte, eq } from 'drizzle-orm';
import db from './db';
import { trafficEvents } from './db/schema';
import { existsSync } from 'node:fs';

export type Interval = '1h' | '12h' | '24h' | '7d' | '30d';

const LOG_FILE = '/logs/access.log';

const INTERVAL_SECONDS: Record<Interval, number> = {
  '1h': 3600,
  '12h': 43200,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
};

function getIntervalStart(interval: Interval): number {
  return Math.floor(Date.now() / 1000) - INTERVAL_SECONDS[interval];
}

function buildWhere(interval: Interval, host: string) {
  const since = getIntervalStart(interval);
  const conditions = [gte(trafficEvents.ts, since)];
  if (host !== 'all' && host !== '') conditions.push(eq(trafficEvents.host, host));
  return and(...conditions);
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  totalRequests: number;
  uniqueIps: number;
  blockedRequests: number;
  blockedPercent: number;
  bytesServed: number;
  loggingDisabled: boolean;
}

export async function getAnalyticsSummary(interval: Interval, host: string): Promise<AnalyticsSummary> {
  const loggingDisabled = !existsSync(LOG_FILE);
  const where = buildWhere(interval, host);

  const row = db
    .select({
      total: sql<number>`count(*)`,
      uniqueIps: sql<number>`count(distinct ${trafficEvents.clientIp})`,
      blocked: sql<number>`sum(case when ${trafficEvents.isBlocked} then 1 else 0 end)`,
      bytes: sql<number>`sum(${trafficEvents.bytesSent})`,
    })
    .from(trafficEvents)
    .where(where)
    .get();

  const total = row?.total ?? 0;
  const blocked = row?.blocked ?? 0;

  return {
    totalRequests: total,
    uniqueIps: row?.uniqueIps ?? 0,
    blockedRequests: blocked,
    blockedPercent: total > 0 ? Math.round((blocked / total) * 1000) / 10 : 0,
    bytesServed: row?.bytes ?? 0,
    loggingDisabled,
  };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineBucket {
  ts: number;
  total: number;
  blocked: number;
}

export async function getAnalyticsTimeline(interval: Interval, host: string): Promise<TimelineBucket[]> {
  const BUCKET: Record<Interval, number> = { '1h': 300, '12h': 1800, '24h': 3600, '7d': 21600, '30d': 86400 };
  const bucketSize = BUCKET[interval];
  const where = buildWhere(interval, host);

  const rows = db
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

  return rows.map((r) => ({
    ts: r.bucket * bucketSize,
    total: r.total,
    blocked: r.blocked ?? 0,
  }));
}

// ── Countries ────────────────────────────────────────────────────────────────

export interface CountryStats {
  countryCode: string;
  total: number;
  blocked: number;
}

export async function getAnalyticsCountries(interval: Interval, host: string): Promise<CountryStats[]> {
  const where = buildWhere(interval, host);

  const rows = db
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

  return rows.map((r) => ({
    countryCode: r.countryCode ?? 'XX',
    total: r.total,
    blocked: r.blocked ?? 0,
  }));
}

// ── Protocols ────────────────────────────────────────────────────────────────

export interface ProtoStats {
  proto: string;
  count: number;
  percent: number;
}

export async function getAnalyticsProtocols(interval: Interval, host: string): Promise<ProtoStats[]> {
  const where = buildWhere(interval, host);

  const rows = db
    .select({
      proto: trafficEvents.proto,
      count: sql<number>`count(*)`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.proto)
    .orderBy(sql`count(*) desc`)
    .all();

  const total = rows.reduce((s, r) => s + r.count, 0);

  return rows.map((r) => ({
    proto: r.proto || 'Unknown',
    count: r.count,
    percent: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));
}

// ── User Agents ──────────────────────────────────────────────────────────────

export interface UAStats {
  userAgent: string;
  count: number;
  percent: number;
}

export async function getAnalyticsUserAgents(interval: Interval, host: string): Promise<UAStats[]> {
  const where = buildWhere(interval, host);

  const rows = db
    .select({
      userAgent: trafficEvents.userAgent,
      count: sql<number>`count(*)`,
    })
    .from(trafficEvents)
    .where(where)
    .groupBy(trafficEvents.userAgent)
    .orderBy(sql`count(*) desc`)
    .limit(10)
    .all();

  const total = rows.reduce((s, r) => s + r.count, 0);

  return rows.map((r) => ({
    userAgent: r.userAgent || 'Unknown',
    count: r.count,
    percent: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
  }));
}

// ── Blocked events ───────────────────────────────────────────────────────────

export interface BlockedEvent {
  id: number;
  ts: number;
  clientIp: string;
  countryCode: string | null;
  method: string;
  uri: string;
  status: number;
  host: string;
}

export interface BlockedPage {
  events: BlockedEvent[];
  total: number;
  page: number;
  pages: number;
}

export async function getAnalyticsBlocked(interval: Interval, host: string, page: number): Promise<BlockedPage> {
  const pageSize = 10;
  const where = and(buildWhere(interval, host), eq(trafficEvents.isBlocked, true));

  const totalRow = db.select({ total: sql<number>`count(*)` }).from(trafficEvents).where(where).get();
  const total = totalRow?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pages);

  const rows = db
    .select({
      id: trafficEvents.id,
      ts: trafficEvents.ts,
      clientIp: trafficEvents.clientIp,
      countryCode: trafficEvents.countryCode,
      method: trafficEvents.method,
      uri: trafficEvents.uri,
      status: trafficEvents.status,
      host: trafficEvents.host,
    })
    .from(trafficEvents)
    .where(where)
    .orderBy(sql`${trafficEvents.ts} desc`)
    .limit(pageSize)
    .offset((safePage - 1) * pageSize)
    .all();

  return { events: rows, total, page: safePage, pages };
}

// ── Hosts ────────────────────────────────────────────────────────────────────

export async function getAnalyticsHosts(): Promise<string[]> {
  const rows = db
    .selectDistinct({ host: trafficEvents.host })
    .from(trafficEvents)
    .orderBy(trafficEvents.host)
    .all();
  return rows.map((r) => r.host).filter(Boolean);
}
