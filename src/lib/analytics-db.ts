import { existsSync } from 'node:fs';
import db from './db';
import { proxyHosts } from './db/schema';
import {
  querySummary,
  queryTimeline,
  queryCountries,
  queryProtocols,
  queryUserAgents,
  queryBlocked,
  queryDistinctHosts,
  type AnalyticsSummary as CHSummary,
  type TimelineBucket,
  type CountryStats,
  type ProtoStats,
  type UAStats,
  type BlockedEvent,
  type BlockedPage,
} from './clickhouse/client';

export type { TimelineBucket, CountryStats, ProtoStats, UAStats, BlockedEvent, BlockedPage };

export type Interval = '1h' | '12h' | '24h' | '7d' | '30d';

const LOG_FILE = '/logs/access.log';

export const INTERVAL_SECONDS: Record<Interval, number> = {
  '1h': 3600,
  '12h': 43200,
  '24h': 86400,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
};

// ── Summary ──────────────────────────────────────────────────────────────────

export interface AnalyticsSummary extends CHSummary {
  loggingDisabled: boolean;
}

export async function getAnalyticsSummary(from: number, to: number, hosts: string[]): Promise<AnalyticsSummary> {
  const loggingDisabled = !existsSync(LOG_FILE);
  const summary = await querySummary(from, to, hosts);
  return { ...summary, loggingDisabled };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export async function getAnalyticsTimeline(from: number, to: number, hosts: string[]): Promise<TimelineBucket[]> {
  return queryTimeline(from, to, hosts);
}

// ── Countries ────────────────────────────────────────────────────────────────

export async function getAnalyticsCountries(from: number, to: number, hosts: string[]): Promise<CountryStats[]> {
  return queryCountries(from, to, hosts);
}

// ── Protocols ────────────────────────────────────────────────────────────────

export async function getAnalyticsProtocols(from: number, to: number, hosts: string[]): Promise<ProtoStats[]> {
  return queryProtocols(from, to, hosts);
}

// ── User Agents ──────────────────────────────────────────────────────────────

export async function getAnalyticsUserAgents(from: number, to: number, hosts: string[]): Promise<UAStats[]> {
  return queryUserAgents(from, to, hosts);
}

// ── Blocked events ───────────────────────────────────────────────────────────

export async function getAnalyticsBlocked(from: number, to: number, hosts: string[], page: number): Promise<BlockedPage> {
  return queryBlocked(from, to, hosts, page);
}

// ── Hosts ────────────────────────────────────────────────────────────────────

export async function getAnalyticsHosts(): Promise<string[]> {
  const hostSet = new Set<string>();

  // Hosts from ClickHouse traffic events
  const chHosts = await queryDistinctHosts();
  for (const h of chHosts) if (h) hostSet.add(h);

  // All domains configured on proxy hosts (SQLite)
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

  const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(h);
  return Array.from(hostSet).filter(h => !isIp(h)).sort();
}
