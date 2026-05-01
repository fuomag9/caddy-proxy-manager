import { createClient, type ClickHouseClient } from '@clickhouse/client';

// ── Configuration ───────────────────────────────────────────────────────────

const CH_URL = process.env.CLICKHOUSE_URL ?? 'http://clickhouse:8123';
const CH_USER = process.env.CLICKHOUSE_USER ?? 'cpm';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD ?? '';
const CH_DB = process.env.CLICKHOUSE_DB ?? 'analytics';

// Validate CH_DB is a safe identifier (alphanumeric + underscore only)
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(CH_DB)) {
  throw new Error(`CLICKHOUSE_DB contains invalid characters: ${CH_DB}`);
}

// ── Analytics readiness flag ────────────────────────────────────────────────

let analyticsReady = false;

/** Returns true once ClickHouse has been successfully initialised. */
export function isAnalyticsEnabled(): boolean {
  return analyticsReady;
}

// ── Singleton client ────────────────────────────────────────────────────────

let client: ClickHouseClient | null = null;

export function getClient(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: CH_URL,
      username: CH_USER,
      password: CH_PASS,
      database: CH_DB,
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    });
  }
  return client;
}

// ── Table creation ──────────────────────────────────────────────────────────

const TRAFFIC_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS traffic_events (
    ts           DateTime          CODEC(Delta, ZSTD),
    client_ip    String            CODEC(ZSTD(3)),
    country_code LowCardinality(Nullable(String)),
    host         LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    method       LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    uri          String            DEFAULT '' CODEC(ZSTD(3)),
    status       UInt16            DEFAULT 0,
    proto        LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    bytes_sent   UInt64            DEFAULT 0 CODEC(Delta, ZSTD),
    user_agent   String            DEFAULT '' CODEC(ZSTD(3)),
    is_blocked   Bool              DEFAULT false
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192
`;

const WAF_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS waf_events (
    ts           DateTime          CODEC(Delta, ZSTD),
    host         LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    client_ip    String            CODEC(ZSTD(3)),
    country_code LowCardinality(Nullable(String)),
    method       LowCardinality(String) DEFAULT '' CODEC(ZSTD(3)),
    uri          String            DEFAULT '' CODEC(ZSTD(3)),
    rule_id      Nullable(Int32),
    rule_message Nullable(String)  CODEC(ZSTD(3)),
    severity     LowCardinality(Nullable(String)),
    raw_data     Nullable(String)  CODEC(ZSTD(3)),
    blocked      Bool              DEFAULT true
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (host, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192
`;

// Migrations applied to existing tables on startup (idempotent MODIFY COLUMN).
const TRAFFIC_EVENTS_MIGRATIONS = [
  `ALTER TABLE traffic_events MODIFY COLUMN ts DateTime CODEC(Delta, ZSTD)`,
  `ALTER TABLE traffic_events MODIFY COLUMN client_ip String CODEC(ZSTD(3))`,
  `ALTER TABLE traffic_events MODIFY COLUMN country_code LowCardinality(Nullable(String))`,
  `ALTER TABLE traffic_events MODIFY COLUMN host LowCardinality(String) DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE traffic_events MODIFY COLUMN method LowCardinality(String) DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE traffic_events MODIFY COLUMN uri String DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE traffic_events MODIFY COLUMN proto LowCardinality(String) DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE traffic_events MODIFY COLUMN bytes_sent UInt64 DEFAULT 0 CODEC(Delta, ZSTD)`,
  `ALTER TABLE traffic_events MODIFY COLUMN user_agent String DEFAULT '' CODEC(ZSTD(3))`,
];

const WAF_EVENTS_MIGRATIONS = [
  `ALTER TABLE waf_events MODIFY COLUMN ts DateTime CODEC(Delta, ZSTD)`,
  `ALTER TABLE waf_events MODIFY COLUMN host LowCardinality(String) DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE waf_events MODIFY COLUMN client_ip String CODEC(ZSTD(3))`,
  `ALTER TABLE waf_events MODIFY COLUMN country_code LowCardinality(Nullable(String))`,
  `ALTER TABLE waf_events MODIFY COLUMN method LowCardinality(String) DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE waf_events MODIFY COLUMN uri String DEFAULT '' CODEC(ZSTD(3))`,
  `ALTER TABLE waf_events MODIFY COLUMN severity LowCardinality(Nullable(String))`,
  `ALTER TABLE waf_events MODIFY COLUMN rule_message Nullable(String) CODEC(ZSTD(3))`,
  `ALTER TABLE waf_events MODIFY COLUMN raw_data Nullable(String) CODEC(ZSTD(3))`,
];

export async function initClickHouse(): Promise<void> {
  if (!CH_PASS) {
    console.log('ClickHouse analytics disabled (CLICKHOUSE_PASSWORD not set)');
    return;
  }
  const ch = getClient();
  await ch.command({ query: `CREATE DATABASE IF NOT EXISTS ${CH_DB}` });
  await ch.command({ query: TRAFFIC_EVENTS_DDL });
  await ch.command({ query: WAF_EVENTS_DDL });
  for (const q of [...TRAFFIC_EVENTS_MIGRATIONS, ...WAF_EVENTS_MIGRATIONS]) {
    await ch.command({ query: q });
  }
  analyticsReady = true;
}

export async function closeClickHouse(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

// ── Insert helpers ──────────────────────────────────────────────────────────

export interface TrafficEventRow {
  ts: number;
  client_ip: string;
  country_code: string | null;
  host: string;
  method: string;
  uri: string;
  status: number;
  proto: string;
  bytes_sent: number;
  user_agent: string;
  is_blocked: boolean;
}

export interface WafEventRow {
  ts: number;
  host: string;
  client_ip: string;
  country_code: string | null;
  rule_id: number | null;
  rule_message: string | null;
  severity: string | null;
  raw_data: string | null;
  blocked: boolean;
  method: string;
  uri: string;
}

export async function insertTrafficEvents(rows: TrafficEventRow[]): Promise<void> {
  if (!analyticsReady || rows.length === 0) return;
  const ch = getClient();
  // Convert unix timestamp to ClickHouse DateTime string
  const values = rows.map(r => ({
    ...r,
    ts: new Date(r.ts * 1000).toISOString().replace('T', ' ').slice(0, 19),
    is_blocked: r.is_blocked ? 1 : 0,
  }));
  await ch.insert({ table: 'traffic_events', values, format: 'JSONEachRow' });
}

export async function insertWafEvents(rows: WafEventRow[]): Promise<void> {
  if (!analyticsReady || rows.length === 0) return;
  const ch = getClient();
  const values = rows.map(r => ({
    ...r,
    ts: new Date(r.ts * 1000).toISOString().replace('T', ' ').slice(0, 19),
    blocked: r.blocked ? 1 : 0,
  }));
  await ch.insert({ table: 'waf_events', values, format: 'JSONEachRow' });
}

// ── Parameterized query helpers ─────────────────────────────────────────────

type QueryParams = Record<string, unknown>;

/**
 * Build a host filter clause using parameterized query placeholders.
 * Returns the SQL fragment and the params to merge into query_params.
 */
function hostFilter(hosts: string[]): { sql: string; params: QueryParams } {
  if (hosts.length === 0) return { sql: '', params: {} };
  const params: QueryParams = {};
  const placeholders: string[] = [];
  hosts.forEach((h, i) => {
    const key = `host_${i}`;
    params[key] = h;
    placeholders.push(`{${key}:String}`);
  });
  return { sql: ` AND host IN (${placeholders.join(',')})`, params };
}

function timeFilter(): string {
  return `ts >= toDateTime({p_from:UInt32}) AND ts <= toDateTime({p_to:UInt32})`;
}

function timeParams(from: number, to: number): QueryParams {
  return { p_from: safeUint(from), p_to: safeUint(to) };
}

/** Clamp a number to a safe non-negative integer (guards against NaN/Infinity). */
function safeUint(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

async function queryRows<T>(query: string, query_params?: QueryParams): Promise<T[]> {
  if (!analyticsReady) return [];
  const ch = getClient();
  const result = await ch.query({ query, query_params, format: 'JSONEachRow' });
  return result.json<T>();
}

async function queryRow<T>(query: string, query_params?: QueryParams): Promise<T | null> {
  const rows = await queryRows<T>(query, query_params);
  return rows[0] ?? null;
}

// ── Analytics queries (same signatures as old analytics-db.ts) ──────────────

export interface AnalyticsSummary {
  totalRequests: number;
  uniqueIps: number;
  blockedRequests: number;
  blockedPercent: number;
  bytesServed: number;
}

export async function querySummary(from: number, to: number, hosts: string[]): Promise<AnalyticsSummary> {
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);

  const traffic = await queryRow<{ total: string; unique_ips: string; blocked: string; bytes: string }>(`
    SELECT
      count() AS total,
      uniq(client_ip) AS unique_ips,
      countIf(is_blocked) AS blocked,
      sum(bytes_sent) AS bytes
    FROM traffic_events
    WHERE ${timeFilter()}${hf.sql}
  `, { ...tp, ...hf.params });

  const wafRow = await queryRow<{ waf_blocked: string }>(`
    SELECT count() AS waf_blocked
    FROM waf_events
    WHERE ${timeFilter()} AND blocked = true${hf.sql}
  `, { ...tp, ...hf.params });

  const total = Number(traffic?.total ?? 0);
  const geoBlocked = Number(traffic?.blocked ?? 0);
  const wafBlocked = Number(wafRow?.waf_blocked ?? 0);
  const blocked = geoBlocked + wafBlocked;

  return {
    totalRequests: total,
    uniqueIps: Number(traffic?.unique_ips ?? 0),
    blockedRequests: blocked,
    blockedPercent: total > 0 ? Math.round((blocked / total) * 1000) / 10 : 0,
    bytesServed: Number(traffic?.bytes ?? 0),
  };
}

export interface TimelineBucket {
  ts: number;
  total: number;
  blocked: number;
}

export function bucketSizeForDuration(seconds: number): number {
  if (seconds <= 3600) return 300;
  if (seconds <= 43200) return 1800;
  if (seconds <= 86400) return 3600;
  if (seconds <= 7 * 86400) return 21600;
  return 86400;
}

export async function queryTimeline(from: number, to: number, hosts: string[]): Promise<TimelineBucket[]> {
  const bucketSize = bucketSizeForDuration(to - from);
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);

  const rows = await queryRows<{ bucket: string; total: string; blocked: string }>(`
    SELECT
      intDiv(toUInt32(ts), {p_bucket:UInt32}) AS bucket,
      count() AS total,
      countIf(is_blocked) AS blocked
    FROM traffic_events
    WHERE ${timeFilter()}${hf.sql}
    GROUP BY bucket
    ORDER BY bucket
  `, { ...tp, ...hf.params, p_bucket: safeUint(bucketSize) });

  return rows.map(r => ({
    ts: Number(r.bucket) * bucketSize,
    total: Number(r.total),
    blocked: Number(r.blocked),
  }));
}

export interface CountryStats {
  countryCode: string;
  total: number;
  blocked: number;
}

export async function queryCountries(from: number, to: number, hosts: string[]): Promise<CountryStats[]> {
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);

  const rows = await queryRows<{ country_code: string | null; total: string; blocked: string }>(`
    SELECT
      country_code,
      count() AS total,
      countIf(is_blocked) AS blocked
    FROM traffic_events
    WHERE ${timeFilter()}${hf.sql}
    GROUP BY country_code
    ORDER BY total DESC
  `, { ...tp, ...hf.params });

  return rows.map(r => ({
    countryCode: r.country_code ?? 'XX',
    total: Number(r.total),
    blocked: Number(r.blocked),
  }));
}

export interface ProtoStats {
  proto: string;
  count: number;
  percent: number;
}

export async function queryProtocols(from: number, to: number, hosts: string[]): Promise<ProtoStats[]> {
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);

  const rows = await queryRows<{ proto: string; count: string }>(`
    SELECT
      proto,
      count() AS count
    FROM traffic_events
    WHERE ${timeFilter()}${hf.sql}
    GROUP BY proto
    ORDER BY count DESC
  `, { ...tp, ...hf.params });

  const total = rows.reduce((s, r) => s + Number(r.count), 0);

  return rows.map(r => ({
    proto: r.proto || 'Unknown',
    count: Number(r.count),
    percent: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
  }));
}

export interface UAStats {
  userAgent: string;
  count: number;
  percent: number;
}

export async function queryUserAgents(from: number, to: number, hosts: string[]): Promise<UAStats[]> {
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);

  const rows = await queryRows<{ user_agent: string; count: string }>(`
    SELECT
      user_agent,
      count() AS count
    FROM traffic_events
    WHERE ${timeFilter()}${hf.sql}
    GROUP BY user_agent
    ORDER BY count DESC
    LIMIT 10
  `, { ...tp, ...hf.params });

  const total = rows.reduce((s, r) => s + Number(r.count), 0);

  return rows.map(r => ({
    userAgent: r.user_agent || 'Unknown',
    count: Number(r.count),
    percent: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
  }));
}

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

export async function queryBlocked(from: number, to: number, hosts: string[], page: number): Promise<BlockedPage> {
  if (!analyticsReady) return { events: [], total: 0, page: 1, pages: 1 };
  const pageSize = 10;
  const hf = hostFilter(hosts);
  const tp = timeParams(from, to);
  const whereSQL = `${timeFilter()} AND is_blocked = true${hf.sql}`;
  const params = { ...tp, ...hf.params };

  const totalRow = await queryRow<{ total: string }>(`SELECT count() AS total FROM traffic_events WHERE ${whereSQL}`, params);
  const total = Number(totalRow?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Number.isFinite(page) ? page : 1), pages);

  const rows = await queryRows<{
    ts: string; client_ip: string; country_code: string | null;
    method: string; uri: string; status: string; host: string;
  }>(`
    SELECT toUInt32(ts) AS ts, client_ip, country_code, method, uri, status, host
    FROM traffic_events
    WHERE ${whereSQL}
    ORDER BY ts DESC
    LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}
  `, { ...params, p_limit: pageSize, p_offset: (safePage - 1) * pageSize });

  return {
    events: rows.map((r, i) => ({
      id: (safePage - 1) * pageSize + i + 1,
      ts: Number(r.ts),
      clientIp: r.client_ip,
      countryCode: r.country_code,
      method: r.method,
      uri: r.uri,
      status: Number(r.status),
      host: r.host,
    })),
    total,
    page: safePage,
    pages,
  };
}

export async function queryDistinctHosts(): Promise<string[]> {
  const rows = await queryRows<{ host: string }>(`SELECT DISTINCT host FROM traffic_events WHERE host != ''`);
  return rows.map(r => r.host);
}

// ── WAF analytics queries ───────────────────────────────────────────────────

export async function queryWafCount(from: number, to: number): Promise<number> {
  const tp = timeParams(from, to);
  const row = await queryRow<{ value: string }>(`
    SELECT count() AS value FROM waf_events WHERE ${timeFilter()}
  `, tp);
  return Number(row?.value ?? 0);
}

export async function queryWafCountWithSearch(search?: string): Promise<number> {
  if (!search) {
    const row = await queryRow<{ value: string }>(`SELECT count() AS value FROM waf_events`);
    return Number(row?.value ?? 0);
  }
  const row = await queryRow<{ value: string }>(`
    SELECT count() AS value FROM waf_events
    WHERE host ILIKE {p_search:String}
       OR client_ip ILIKE {p_search:String}
       OR uri ILIKE {p_search:String}
       OR rule_message ILIKE {p_search:String}
  `, { p_search: `%${search}%` });
  return Number(row?.value ?? 0);
}

export interface TopWafRule {
  ruleId: number;
  count: number;
  message: string | null;
}

export async function queryTopWafRules(from: number, to: number, limit = 10): Promise<TopWafRule[]> {
  const tp = timeParams(from, to);
  const rows = await queryRows<{ rule_id: string; count: string; message: string | null }>(`
    SELECT
      rule_id,
      count() AS count,
      any(rule_message) AS message
    FROM waf_events
    WHERE ${timeFilter()} AND rule_id IS NOT NULL
    GROUP BY rule_id
    ORDER BY count DESC
    LIMIT {p_limit:UInt32}
  `, { ...tp, p_limit: safeUint(limit) });

  return rows
    .filter(r => r.rule_id != null)
    .map(r => ({ ruleId: Number(r.rule_id), count: Number(r.count), message: r.message ?? null }));
}

export interface TopWafRuleWithHosts {
  ruleId: number;
  count: number;
  message: string | null;
  hosts: { host: string; count: number }[];
}

export async function queryTopWafRulesWithHosts(from: number, to: number, limit = 10): Promise<TopWafRuleWithHosts[]> {
  const topRules = await queryTopWafRules(from, to, limit);
  if (topRules.length === 0) return [];

  // Rule IDs come from ClickHouse query results — they are integers, safe for IN clause
  const ruleIds = topRules.map(r => r.ruleId);
  const tp = timeParams(from, to);
  const ruleParams: QueryParams = {};
  const rulePlaceholders: string[] = [];
  ruleIds.forEach((id, i) => {
    const key = `rid_${i}`;
    ruleParams[key] = id;
    rulePlaceholders.push(`{${key}:Int32}`);
  });

  const hostRows = await queryRows<{ rule_id: string; host: string; count: string }>(`
    SELECT rule_id, host, count() AS count
    FROM waf_events
    WHERE ${timeFilter()} AND rule_id IN (${rulePlaceholders.join(',')})
    GROUP BY rule_id, host
    ORDER BY count DESC
  `, { ...tp, ...ruleParams });

  return topRules.map(rule => ({
    ...rule,
    hosts: hostRows
      .filter(r => Number(r.rule_id) === rule.ruleId)
      .map(r => ({ host: r.host, count: Number(r.count) })),
  }));
}

export async function queryWafCountries(from: number, to: number): Promise<{ countryCode: string; count: number }[]> {
  const tp = timeParams(from, to);
  const rows = await queryRows<{ country_code: string | null; count: string }>(`
    SELECT country_code, count() AS count
    FROM waf_events
    WHERE ${timeFilter()}
    GROUP BY country_code
    ORDER BY count DESC
  `, tp);
  return rows.map(r => ({ countryCode: r.country_code ?? 'XX', count: Number(r.count) }));
}

export async function queryWafRuleMessages(ruleIds: number[]): Promise<Record<number, string | null>> {
  if (ruleIds.length === 0) return {};
  const params: QueryParams = {};
  const placeholders: string[] = [];
  ruleIds.forEach((id, i) => {
    const key = `rid_${i}`;
    params[key] = id;
    placeholders.push(`{${key}:Int32}`);
  });
  const rows = await queryRows<{ rule_id: string; message: string | null }>(`
    SELECT rule_id, any(rule_message) AS message
    FROM waf_events
    WHERE rule_id IN (${placeholders.join(',')})
    GROUP BY rule_id
  `, params);
  return Object.fromEntries(
    rows.filter(r => r.rule_id != null).map(r => [Number(r.rule_id), r.message ?? null])
  );
}

export interface WafEvent {
  id: number;
  ts: number;
  host: string;
  clientIp: string;
  countryCode: string | null;
  method: string;
  uri: string;
  ruleId: number | null;
  ruleMessage: string | null;
  severity: string | null;
  rawData: string | null;
  blocked: boolean;
}

export async function queryWafEvents(limit = 50, offset = 0, search?: string): Promise<WafEvent[]> {
  const safeLimit = safeUint(limit);
  const safeOffset = safeUint(offset);

  let query: string;
  let params: QueryParams;

  if (search) {
    query = `
      SELECT toUInt32(ts) AS ts, host, client_ip, country_code, method, uri,
             rule_id, rule_message, severity, raw_data, blocked
      FROM waf_events
      WHERE host ILIKE {p_search:String}
         OR client_ip ILIKE {p_search:String}
         OR uri ILIKE {p_search:String}
         OR rule_message ILIKE {p_search:String}
      ORDER BY ts DESC
      LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}
    `;
    params = { p_search: `%${search}%`, p_limit: safeLimit, p_offset: safeOffset };
  } else {
    query = `
      SELECT toUInt32(ts) AS ts, host, client_ip, country_code, method, uri,
             rule_id, rule_message, severity, raw_data, blocked
      FROM waf_events
      WHERE 1=1
      ORDER BY ts DESC
      LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}
    `;
    params = { p_limit: safeLimit, p_offset: safeOffset };
  }

  const rows = await queryRows<{
    ts: string; host: string; client_ip: string; country_code: string | null;
    method: string; uri: string; rule_id: string | null; rule_message: string | null;
    severity: string | null; raw_data: string | null; blocked: string;
  }>(query, params);

  return rows.map((r, i) => ({
    id: safeOffset + i + 1,
    ts: Number(r.ts),
    host: r.host,
    clientIp: r.client_ip,
    countryCode: r.country_code ?? null,
    method: r.method,
    uri: r.uri,
    ruleId: r.rule_id != null ? Number(r.rule_id) : null,
    ruleMessage: r.rule_message ?? null,
    severity: r.severity ?? null,
    rawData: r.raw_data ?? null,
    blocked: Boolean(Number(r.blocked)),
  }));
}
