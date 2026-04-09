import {
  queryWafCount,
  queryWafCountWithSearch,
  queryTopWafRules,
  queryTopWafRulesWithHosts,
  queryWafCountries,
  queryWafRuleMessages,
  queryWafEvents,
  type WafEvent,
  type TopWafRule,
  type TopWafRuleWithHosts,
} from "../clickhouse/client";

export type { WafEvent, TopWafRule, TopWafRuleWithHosts };

export async function countWafEvents(search?: string): Promise<number> {
  return queryWafCountWithSearch(search);
}

export async function countWafEventsInRange(from: number, to: number): Promise<number> {
  return queryWafCount(from, to);
}

export async function getTopWafRules(from: number, to: number, limit = 10): Promise<TopWafRule[]> {
  return queryTopWafRules(from, to, limit);
}

export async function getTopWafRulesWithHosts(from: number, to: number, limit = 10): Promise<TopWafRuleWithHosts[]> {
  return queryTopWafRulesWithHosts(from, to, limit);
}

export async function getWafEventCountries(from: number, to: number): Promise<{ countryCode: string; count: number }[]> {
  return queryWafCountries(from, to);
}

export async function getWafRuleMessages(ruleIds: number[]): Promise<Record<number, string | null>> {
  return queryWafRuleMessages(ruleIds);
}

export async function listWafEvents(limit = 50, offset = 0, search?: string): Promise<WafEvent[]> {
  return queryWafEvents(limit, offset, search);
}
