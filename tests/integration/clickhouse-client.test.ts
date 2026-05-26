import { afterEach, describe, expect, it, vi } from 'vitest';

describe('clickhouse client analytics enablement', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock('@clickhouse/client');
  });

  it('treats analytics as enabled when CLICKHOUSE_PASSWORD is configured before init runs', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');

    const query = vi
      .fn()
      .mockResolvedValueOnce({ json: async () => [{ total: '12', unique_ips: '4', blocked: '2', bytes: '1024' }] })
      .mockResolvedValueOnce({ json: async () => [{ waf_blocked: '3' }] });

    const createClient = vi.fn(() => ({ query, command: vi.fn(), insert: vi.fn(), close: vi.fn() }));

    vi.doMock('@clickhouse/client', () => ({
      createClient,
    }));

    const { isAnalyticsEnabled, querySummary } = await import('@/src/lib/clickhouse/client');

    expect(isAnalyticsEnabled()).toBe(true);

    await expect(querySummary(0, 60, [])).resolves.toEqual({
      totalRequests: 12,
      uniqueIps: 4,
      blockedRequests: 5,
      blockedPercent: 41.7,
      bytesServed: 1024,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      log: { level: 127 },
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 0,
      },
    }));
  });

  it('treats analytics as disabled when CLICKHOUSE_PASSWORD is missing', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', '');

    const createClient = vi.fn();
    vi.doMock('@clickhouse/client', () => ({ createClient }));

    const { isAnalyticsEnabled, querySummary } = await import('@/src/lib/clickhouse/client');

    expect(isAnalyticsEnabled()).toBe(false);

    await expect(querySummary(0, 60, [])).resolves.toEqual({
      totalRequests: 0,
      uniqueIps: 0,
      blockedRequests: 0,
      blockedPercent: 0,
      bytesServed: 0,
    });

    expect(createClient).not.toHaveBeenCalled();
  });

  it('defaults retention to 30 days and creates tables with a 30-day TTL', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');
    vi.stubEnv('CLICKHOUSE_RETENTION_DAYS', '');

    const commands: string[] = [];
    const command = vi.fn(async ({ query }: { query: string }) => { commands.push(query); });
    // ensureRetentionTtl reads the live TTL; report it already matches 30 days.
    const query = vi.fn(async () => ({ json: async () => [{ create_table_query: 'TTL ts + toIntervalDay(30)' }] }));

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command, insert: vi.fn(), close: vi.fn() })),
    }));

    const { getRetentionDays, initClickHouse } = await import('@/src/lib/clickhouse/client');
    expect(getRetentionDays()).toBe(30);

    await initClickHouse();

    const trafficDdl = commands.find(q => q.includes('CREATE TABLE IF NOT EXISTS traffic_events'));
    const wafDdl = commands.find(q => q.includes('CREATE TABLE IF NOT EXISTS waf_events'));
    expect(trafficDdl).toContain('TTL ts + INTERVAL 30 DAY DELETE');
    expect(wafDdl).toContain('TTL ts + INTERVAL 30 DAY DELETE');
    // TTL already matches → no MODIFY TTL migration issued.
    expect(commands.some(q => q.includes('MODIFY TTL'))).toBe(false);
  });

  it('honors a custom retention value and migrates an existing table whose TTL differs', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');
    vi.stubEnv('CLICKHOUSE_RETENTION_DAYS', '7');

    const commands: string[] = [];
    const command = vi.fn(async ({ query }: { query: string }) => { commands.push(query); });
    // Existing tables were created under the old 90-day TTL.
    const query = vi.fn(async () => ({ json: async () => [{ create_table_query: 'TTL ts + toIntervalDay(90)' }] }));

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command, insert: vi.fn(), close: vi.fn() })),
    }));

    const { getRetentionDays, initClickHouse } = await import('@/src/lib/clickhouse/client');
    expect(getRetentionDays()).toBe(7);

    await initClickHouse();

    expect(commands.find(q => q.includes('CREATE TABLE IF NOT EXISTS traffic_events')))
      .toContain('TTL ts + INTERVAL 7 DAY DELETE');
    const modifies = commands.filter(q => /ALTER TABLE \w+ MODIFY TTL ts \+ INTERVAL 7 DAY DELETE/.test(q));
    expect(modifies).toHaveLength(2);
  });

  it('throws when CLICKHOUSE_RETENTION_DAYS is not a positive integer', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');
    vi.stubEnv('CLICKHOUSE_RETENTION_DAYS', 'not-a-number');
    vi.doMock('@clickhouse/client', () => ({ createClient: vi.fn() }));

    await expect(import('@/src/lib/clickhouse/client')).rejects.toThrow(/CLICKHOUSE_RETENTION_DAYS/);
  });

  it('drops the disabled diagnostic system-log tables on init to reclaim their data', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');

    const commands: string[] = [];
    const command = vi.fn(async ({ query }: { query: string }) => { commands.push(query); });
    const query = vi.fn(async () => ({ json: async () => [{ create_table_query: 'TTL ts + toIntervalDay(30)' }] }));

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command, insert: vi.fn(), close: vi.fn() })),
    }));

    const { initClickHouse } = await import('@/src/lib/clickhouse/client');
    await initClickHouse();

    const expected = [
      'metric_log', 'asynchronous_metric_log', 'trace_log', 'query_log', 'query_thread_log',
      'query_views_log', 'part_log', 'processors_profile_log', 'text_log', 'session_log',
      'opentelemetry_span_log', 'blob_storage_log', 'backup_log',
    ];
    for (const name of expected) {
      expect(commands).toContain(`DROP TABLE IF EXISTS system.${name} SYNC`);
    }
  });

  it('does not abort init when dropping system-log tables fails (insufficient privileges)', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');

    const dropAttempts: string[] = [];
    const command = vi.fn(async ({ query }: { query: string }) => {
      if (query.startsWith('DROP TABLE IF EXISTS system.')) {
        dropAttempts.push(query);
        throw new Error('Not enough privileges. To execute this query, it is necessary to have the grant DROP TABLE');
      }
    });
    const query = vi.fn(async () => ({ json: async () => [{ create_table_query: 'TTL ts + toIntervalDay(30)' }] }));

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command, insert: vi.fn(), close: vi.fn() })),
    }));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { initClickHouse } = await import('@/src/lib/clickhouse/client');
    // Best-effort: a privilege error must not reject and abort startup.
    await expect(initClickHouse()).resolves.toBeUndefined();

    // Bails out after the first failure rather than spamming a warning per table.
    expect(dropAttempts).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('could not drop disabled system log tables');

    warn.mockRestore();
  });

  it('returns full WAF stats for the filtered result set', async () => {
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'test-clickhouse-password');

    const query = vi.fn().mockResolvedValueOnce({
      json: async () => [{ total: '5400', blocked: '5400', critical: '5400', unique_hosts: '1', rule_ids_triggered: '3' }],
    });

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command: vi.fn(), insert: vi.fn(), close: vi.fn() })),
    }));

    const { queryWafEventStatsWithSearch } = await import('@/src/lib/clickhouse/client');

    await expect(queryWafEventStatsWithSearch('example.com')).resolves.toEqual({
      total: 5400,
      blocked: 5400,
      critical: 5400,
      uniqueHosts: 1,
      ruleIdsTriggered: 3,
    });

    expect(query).toHaveBeenCalledTimes(1);
  });
});
