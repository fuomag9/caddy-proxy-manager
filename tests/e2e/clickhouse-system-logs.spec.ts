import { test, expect } from '@playwright/test';
import { createClient, type ClickHouseClient } from '@clickhouse/client';

// docker/clickhouse/config.d/low-disk-write.xml is mounted into the ClickHouse
// container by docker-compose.yml and turns these diagnostic system-log tables
// off with remove="1". On stock ClickHouse they flush every few seconds even
// when the proxy is idle, writing several GB/day; disabling them means the
// tables are never created, so disk writes stay proportional to real traffic.
// Keep this list in sync with low-disk-write.xml and DISABLED_SYSTEM_LOGS in
// src/lib/clickhouse/client.ts.
const DISABLED_SYSTEM_LOGS = [
  'metric_log',
  'asynchronous_metric_log',
  'trace_log',
  'query_log',
  'query_thread_log',
  'query_views_log',
  'part_log',
  'processors_profile_log',
  'text_log',
  'session_log',
  'opentelemetry_span_log',
  'blob_storage_log',
  'backup_log',
  'histogram_metric_log',
] as const;

// ClickHouse HTTP port is exposed to the host by tests/docker-compose.test.yml.
function makeClient(): ClickHouseClient {
  return createClient({
    url: 'http://localhost:8123',
    username: 'cpm',
    password: 'test-clickhouse-password-2026',
    database: 'analytics',
  });
}

test.describe('ClickHouse internal system logs disabled', () => {
  test('none of the disabled diagnostic system-log tables exist', async () => {
    const ch = makeClient();
    // Table names are hard-coded safe identifiers, so an inline IN list is fine.
    const inList = DISABLED_SYSTEM_LOGS.map((n) => `'${n}'`).join(', ');
    try {
      // remove="1" stops ClickHouse from ever setting up these log queues, so
      // the tables are never created. If the override is dropped or unmounted,
      // they reappear in system.tables and this assertion fails.
      const result = await ch.query({
        query: `SELECT name FROM system.tables WHERE database = 'system' AND name IN (${inList}) ORDER BY name`,
        format: 'JSONEachRow',
      });
      const present = (await result.json<{ name: string }>()).map((r) => r.name);
      expect(present, `disabled system-log tables should not exist, found: ${present.join(', ')}`).toEqual([]);
    } finally {
      await ch.close();
    }
  });
});
