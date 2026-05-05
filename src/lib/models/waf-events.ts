import {
  queryWafCount,
  queryWafCountWithSearch,
  queryWafEventStatsWithSearch,
  queryTopWafRules,
  queryTopWafRulesWithHosts,
  queryWafCountries,
  queryWafRuleMessages,
  queryWafEvents,
  type WafEvent,
  type WafEventStats,
  type TopWafRule,
  type TopWafRuleWithHosts,
} from "../clickhouse/client";

export type { WafEvent, WafEventStats, TopWafRule, TopWafRuleWithHosts };

const EMPTY_WAF_STATS: WafEventStats = {
  total: 0,
  blocked: 0,
  critical: 0,
  uniqueHosts: 0,
  ruleIdsTriggered: 0,
};

function isClickHouseConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "ECONNREFUSED" || code === "FailedToOpenSocket") return true;

  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause && cause !== error && isClickHouseConnectionError(cause)) return true;

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ECONNREFUSED") || message.includes("FailedToOpenSocket") || message.includes("Was there a typo in the url or port?");
}

async function withWafAnalyticsFallback<T>(operation: string, fallback: T, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (isClickHouseConnectionError(error)) {
      console.warn(`[waf-events] ClickHouse unavailable during ${operation}; returning empty WAF analytics.`);
      return fallback;
    }
    throw error;
  }
}

export async function countWafEvents(search?: string, from?: number, to?: number): Promise<number> {
  return withWafAnalyticsFallback("countWafEvents", 0, () => queryWafCountWithSearch(search, from, to));
}

export async function getWafEventStats(search?: string, from?: number, to?: number): Promise<WafEventStats> {
  return withWafAnalyticsFallback("getWafEventStats", EMPTY_WAF_STATS, () => queryWafEventStatsWithSearch(search, from, to));
}

export async function countWafEventsInRange(from: number, to: number): Promise<number> {
  return withWafAnalyticsFallback("countWafEventsInRange", 0, () => queryWafCount(from, to));
}

export async function getTopWafRules(from: number, to: number, limit = 10): Promise<TopWafRule[]> {
  return withWafAnalyticsFallback("getTopWafRules", [], () => queryTopWafRules(from, to, limit));
}

export async function getTopWafRulesWithHosts(from: number, to: number, limit = 10): Promise<TopWafRuleWithHosts[]> {
  return withWafAnalyticsFallback("getTopWafRulesWithHosts", [], () => queryTopWafRulesWithHosts(from, to, limit));
}

export async function getWafEventCountries(from: number, to: number): Promise<{ countryCode: string; count: number }[]> {
  return withWafAnalyticsFallback("getWafEventCountries", [], () => queryWafCountries(from, to));
}

export async function getWafRuleMessages(ruleIds: number[]): Promise<Record<number, string | null>> {
  return withWafAnalyticsFallback("getWafRuleMessages", {}, () => queryWafRuleMessages(ruleIds));
}

export async function listWafEvents(limit = 50, offset = 0, search?: string, from?: number, to?: number): Promise<WafEvent[]> {
  return withWafAnalyticsFallback("listWafEvents", [], () => queryWafEvents(limit, offset, search, from, to));
}
