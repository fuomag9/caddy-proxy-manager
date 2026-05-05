import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/clickhouse/client', () => ({
  queryWafCount: vi.fn(),
  queryWafCountWithSearch: vi.fn(),
  queryWafEventStatsWithSearch: vi.fn(),
  queryTopWafRules: vi.fn(),
  queryTopWafRulesWithHosts: vi.fn(),
  queryWafCountries: vi.fn(),
  queryWafRuleMessages: vi.fn(),
  queryWafEvents: vi.fn(),
}));

import {
  countWafEvents,
  getTopWafRulesWithHosts,
  getWafEventStats,
  getWafRuleMessages,
  listWafEvents,
} from '@/src/lib/models/waf-events';
import {
  queryTopWafRulesWithHosts,
  queryWafCountWithSearch,
  queryWafEventStatsWithSearch,
  queryWafEvents,
  queryWafRuleMessages,
} from '@/src/lib/clickhouse/client';

const mockQueryWafCountWithSearch = vi.mocked(queryWafCountWithSearch);
const mockQueryWafEventStatsWithSearch = vi.mocked(queryWafEventStatsWithSearch);
const mockQueryTopWafRulesWithHosts = vi.mocked(queryTopWafRulesWithHosts);
const mockQueryWafRuleMessages = vi.mocked(queryWafRuleMessages);
const mockQueryWafEvents = vi.mocked(queryWafEvents);

describe('waf-events ClickHouse fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results for connection failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const connectionError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8123'), { code: 'ECONNREFUSED' });

    mockQueryWafCountWithSearch.mockRejectedValueOnce(connectionError);
    mockQueryWafEventStatsWithSearch.mockRejectedValueOnce(connectionError);
    mockQueryTopWafRulesWithHosts.mockRejectedValueOnce(connectionError);
    mockQueryWafRuleMessages.mockRejectedValueOnce(connectionError);
    mockQueryWafEvents.mockRejectedValueOnce(connectionError);

    await expect(countWafEvents('fuo.fi', 100, 200)).resolves.toBe(0);
    await expect(getWafEventStats('fuo.fi', 100, 200)).resolves.toEqual({
      total: 0,
      blocked: 0,
      critical: 0,
      uniqueHosts: 0,
      ruleIdsTriggered: 0,
    });
    await expect(getTopWafRulesWithHosts(100, 200)).resolves.toEqual([]);
    await expect(getWafRuleMessages([941100])).resolves.toEqual({});
    await expect(listWafEvents(50, 0, 'fuo.fi', 100, 200)).resolves.toEqual([]);

    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledWith('[waf-events] ClickHouse unavailable during countWafEvents; returning empty WAF analytics.');
  });

  it('detects nested FailedToOpenSocket causes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockQueryWafEvents.mockRejectedValueOnce({
      cause: new Error('FailedToOpenSocket: Was there a typo in the url or port?'),
    });

    await expect(listWafEvents()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith('[waf-events] ClickHouse unavailable during listWafEvents; returning empty WAF analytics.');
  });

  it('rethrows non-connection query failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('syntax error at position 42');
    mockQueryWafEventStatsWithSearch.mockRejectedValueOnce(error);

    await expect(getWafEventStats('fuo.fi')).rejects.toThrow('syntax error at position 42');
    expect(warn).not.toHaveBeenCalled();
  });
});
