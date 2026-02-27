import { sql, and, gte, lte, eq, inArray } from 'drizzle-orm';
import db from './db';
import { trafficEvents, proxyHosts } from './db/schema';
import { existsSync } from 'node:fs';

export type Interval = '1h' | '12h' | '24h' | '7d' | '30d';

const LOG_FILE = '/logs/access.log';

export const INTERVAL_SECONDS: Record<Interval, number> = {
  '1h': 3600,
  '12h': 43200,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
};

function buildWhere(from: number, to: number, hosts: string[]) {
  const conditions = [gte(trafficEvents.ts, from), lte(trafficEvents.ts, to)];
  if (hosts.length === 1) {
    conditions.push(eq(trafficEvents.host, hosts[0]));
  } else if (hosts.length > 1) {
    conditions.push(inArray(trafficEvents.host, hosts));
  }
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

export async function getAnalyticsSummary(from: number, to: number, hosts: string[]): Promise<AnalyticsSummary> {
  const loggingDisabled = !existsSync(LOG_FILE);
  const where = buildWhere(from, to, hosts);

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

function bucketSizeForDuration(seconds: number): number {
  if (seconds <= 3600) return 300;
  if (seconds <= 43200) return 1800;
  if (seconds <= 86400) return 3600;
  if (seconds <= 7 * 86400) return 21600;
  return 86400;
}

export async function getAnalyticsTimeline(from: number, to: number, hosts: string[]): Promise<TimelineBucket[]> {
  const bucketSize = bucketSizeForDuration(to - from);
  const where = buildWhere(from, to, hosts);

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

export async function getAnalyticsCountries(from: number, to: number, hosts: string[]): Promise<CountryStats[]> {
  const where = buildWhere(from, to, hosts);

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

export async function getAnalyticsProtocols(from: number, to: number, hosts: string[]): Promise<ProtoStats[]> {
  const where = buildWhere(from, to, hosts);

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

export async function getAnalyticsUserAgents(from: number, to: number, hosts: string[]): Promise<UAStats[]> {
  const where = buildWhere(from, to, hosts);

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

export async function getAnalyticsBlocked(from: number, to: number, hosts: string[], page: number): Promise<BlockedPage> {
  const pageSize = 10;
  const where = and(buildWhere(from, to, hosts), eq(trafficEvents.isBlocked, true));

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
  const hostSet = new Set<string>();

  // Hosts that appear in traffic events
  const trafficRows = db.selectDistinct({ host: trafficEvents.host }).from(trafficEvents).all();
  for (const r of trafficRows) if (r.host) hostSet.add(r.host);

  // All domains configured on proxy hosts (even those with no traffic yet)
  const proxyRows = db.select({ domains: proxyHosts.domains }).from(proxyHosts).all();
  for (const r of proxyRows) {
    try {
      const domains = JSON.parse(r.domains) as string[];
      for (const d of domains) {
        const trimmed = d?.trim().toLowerCase();
        if (trimmed) hostSet.add(trimmed);
      }
    } catch { /* ignore malformed rows */ }
  }

  return Array.from(hostSet).sort();
}
