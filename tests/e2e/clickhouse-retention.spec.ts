import { test, expect } from '@playwright/test';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

// The web container creates the tables with this TTL on startup. The test stack
// leaves CLICKHOUSE_RETENTION_DAYS unset, so both default to 30.
const RETENTION_DAYS = Number(process.env.CLICKHOUSE_RETENTION_DAYS ?? 30);
const DAY_SECONDS = 86_400;

// ClickHouse HTTP port is exposed to the host by tests/docker-compose.test.yml.
function makeClient(): ClickHouseClient {
  return createClient({
    url: 'http://localhost:8123',
    username: 'cpm',
    password: 'test-clickhouse-password-2026',
    database: 'analytics',
  });
}

function chDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

async function countRows(
  ch: ClickHouseClient,
  table: 'traffic_events' | 'waf_events',
  host: string,
  beforeTs?: number,
): Promise<number> {
  const clauses = ['host = {h:String}'];
  const params: Record<string, unknown> = { h: host };
  if (beforeTs != null) {
    clauses.push('ts < toDateTime({t:UInt32})');
    params.t = beforeTs;
  }
  const result = await ch.query({
    query: `SELECT count() AS c FROM ${table} WHERE ${clauses.join(' AND ')}`,
    query_params: params,
    format: 'JSONEachRow',
  });
  const rows = await result.json<{ c: string }>();
  return Number(rows[0]?.c ?? 0);
}

// TTL deletion is lazy (background merges). Force it synchronously so the test
// is deterministic: MATERIALIZE TTL recomputes TTL info and drops expired rows,
// and mutations_sync=2 makes the command block until that mutation finishes.
async function forceTtl(ch: ClickHouseClient, table: 'traffic_events' | 'waf_events'): Promise<void> {
  await ch.command({ query: `ALTER TABLE ${table} MATERIALIZE TTL SETTINGS mutations_sync = 2` });
  await ch.command({ query: `OPTIMIZE TABLE ${table} FINAL` });
}

test.describe('ClickHouse retention TTL', () => {
  test('tables carry the configured retention TTL', async () => {
    const ch = makeClient();
    try {
      for (const table of ['traffic_events', 'waf_events'] as const) {
        const result = await ch.query({
          query: `SELECT create_table_query FROM system.tables WHERE database = 'analytics' AND name = {tbl:String}`,
          query_params: { tbl: table },
          format: 'JSONEachRow',
        });
        const rows = await result.json<{ create_table_query: string }>();
        const ddl = rows[0]?.create_table_query ?? '';
        expect(ddl, `${table} should have a TTL`).toMatch(
          new RegExp(`toIntervalDay\\(${RETENTION_DAYS}\\)|INTERVAL ${RETENTION_DAYS} DAY`),
        );
      }
    } finally {
      await ch.close();
    }
  });

  test('purges traffic events past the retention window and keeps recent ones', async () => {
    const ch = makeClient();
    const marker = `ttl-traffic-${Date.now()}.example.com`;
    const nowSec = Math.floor(Date.now() / 1000);
    const retentionBoundary = nowSec - RETENTION_DAYS * DAY_SECONDS;
    const expiredTs = nowSec - (RETENTION_DAYS + 10) * DAY_SECONDS;
    const freshTs = nowSec - DAY_SECONDS;

    try {
      await ch.insert({
        table: 'traffic_events',
        format: 'JSONEachRow',
        values: [
          { ts: chDateTime(expiredTs), client_ip: '203.0.113.1', host: marker, method: 'GET', uri: '/expired', status: 200, proto: 'HTTP/1.1', bytes_sent: 1, user_agent: 'ttl-test', is_blocked: 0 },
          { ts: chDateTime(freshTs), client_ip: '203.0.113.2', host: marker, method: 'GET', uri: '/fresh', status: 200, proto: 'HTTP/1.1', bytes_sent: 1, user_agent: 'ttl-test', is_blocked: 0 },
        ],
      });

      // Don't assert both rows are visible here: ClickHouse schedules a TTL
      // merge as soon as it ingests a part containing already-expired rows, so a
      // count() right after insert races that merge (and reads filter expired
      // rows before physical removal anyway). Force the purge deterministically,
      // then assert only the fresh row survives.
      await forceTtl(ch, 'traffic_events');

      expect(await countRows(ch, 'traffic_events', marker, retentionBoundary)).toBe(0);
      expect(await countRows(ch, 'traffic_events', marker)).toBe(1);
    } finally {
      await ch.command({
        query: `ALTER TABLE traffic_events DELETE WHERE host = {h:String} SETTINGS mutations_sync = 2`,
        query_params: { h: marker },
      }).catch(() => { /* best-effort cleanup */ });
      await ch.close();
    }
  });

  test('purges WAF events past the retention window and keeps recent ones', async () => {
    const ch = makeClient();
    const marker = `ttl-waf-${Date.now()}.example.com`;
    const nowSec = Math.floor(Date.now() / 1000);
    const retentionBoundary = nowSec - RETENTION_DAYS * DAY_SECONDS;
    const expiredTs = nowSec - (RETENTION_DAYS + 10) * DAY_SECONDS;
    const freshTs = nowSec - DAY_SECONDS;

    try {
      await ch.insert({
        table: 'waf_events',
        format: 'JSONEachRow',
        values: [
          { ts: chDateTime(expiredTs), host: marker, client_ip: '203.0.113.1', method: 'GET', uri: '/expired', rule_id: 1, blocked: 1 },
          { ts: chDateTime(freshTs), host: marker, client_ip: '203.0.113.2', method: 'GET', uri: '/fresh', rule_id: 1, blocked: 1 },
        ],
      });

      // See the traffic_events test: count() right after insert races the TTL
      // merge ClickHouse schedules for expired rows, so we don't assert it here.
      await forceTtl(ch, 'waf_events');

      expect(await countRows(ch, 'waf_events', marker, retentionBoundary)).toBe(0);
      expect(await countRows(ch, 'waf_events', marker)).toBe(1);
    } finally {
      await ch.command({
        query: `ALTER TABLE waf_events DELETE WHERE host = {h:String} SETTINGS mutations_sync = 2`,
        query_params: { h: marker },
      }).catch(() => { /* best-effort cleanup */ });
      await ch.close();
    }
  });
});
