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

    vi.doMock('@clickhouse/client', () => ({
      createClient: vi.fn(() => ({ query, command: vi.fn(), insert: vi.fn(), close: vi.fn() })),
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
});
