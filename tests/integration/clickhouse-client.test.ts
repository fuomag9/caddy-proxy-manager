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
