import db from "../db";
import { wafEvents } from "../db/schema";
import { desc, like, or, count, and, gte, lte, sql, inArray } from "drizzle-orm";

export type WafEvent = {
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
};

function buildSearch(search?: string) {
  if (!search) return undefined;
  return or(
    like(wafEvents.host, `%${search}%`),
    like(wafEvents.clientIp, `%${search}%`),
    like(wafEvents.uri, `%${search}%`),
    like(wafEvents.ruleMessage, `%${search}%`)
  );
}

export async function countWafEvents(search?: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wafEvents)
    .where(buildSearch(search));
  return row?.value ?? 0;
}

export async function countWafEventsInRange(from: number, to: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(wafEvents)
    .where(and(gte(wafEvents.ts, from), lte(wafEvents.ts, to)));
  return row?.value ?? 0;
}

export type TopWafRule = { ruleId: number; count: number; message: string | null };

export async function getTopWafRules(from: number, to: number, limit = 10): Promise<TopWafRule[]> {
  const rows = await db
    .select({
      ruleId: wafEvents.ruleId,
      count: count(),
      message: sql<string | null>`MAX(${wafEvents.ruleMessage})`,
    })
    .from(wafEvents)
    .where(and(gte(wafEvents.ts, from), lte(wafEvents.ts, to), sql`${wafEvents.ruleId} IS NOT NULL`))
    .groupBy(wafEvents.ruleId)
    .orderBy(desc(count()))
    .limit(limit);
  return rows
    .filter((r): r is typeof r & { ruleId: number } => r.ruleId != null)
    .map((r) => ({ ruleId: r.ruleId, count: r.count, message: r.message ?? null }));
}

export type TopWafRuleWithHosts = {
  ruleId: number;
  count: number;
  message: string | null;
  hosts: { host: string; count: number }[];
};

export async function getTopWafRulesWithHosts(from: number, to: number, limit = 10): Promise<TopWafRuleWithHosts[]> {
  const topRules = await getTopWafRules(from, to, limit);
  if (topRules.length === 0) return [];

  const ruleIds = topRules.map(r => r.ruleId);
  const hostRows = await db
    .select({ ruleId: wafEvents.ruleId, host: wafEvents.host, count: count() })
    .from(wafEvents)
    .where(and(gte(wafEvents.ts, from), lte(wafEvents.ts, to), inArray(wafEvents.ruleId, ruleIds)))
    .groupBy(wafEvents.ruleId, wafEvents.host)
    .orderBy(desc(count()));

  return topRules.map(rule => ({
    ...rule,
    hosts: hostRows
      .filter(r => r.ruleId === rule.ruleId)
      .map(r => ({ host: r.host, count: r.count })),
  }));
}

export async function getWafEventCountries(from: number, to: number): Promise<{ countryCode: string; count: number }[]> {
  const rows = await db
    .select({ countryCode: wafEvents.countryCode, count: count() })
    .from(wafEvents)
    .where(and(gte(wafEvents.ts, from), lte(wafEvents.ts, to)))
    .groupBy(wafEvents.countryCode)
    .orderBy(desc(count()));
  return rows.map(r => ({ countryCode: r.countryCode ?? 'XX', count: r.count }));
}

export async function getWafRuleMessages(ruleIds: number[]): Promise<Record<number, string | null>> {
  if (ruleIds.length === 0) return {};
  const rows = await db
    .select({
      ruleId: wafEvents.ruleId,
      message: sql<string | null>`MAX(${wafEvents.ruleMessage})`,
    })
    .from(wafEvents)
    .where(inArray(wafEvents.ruleId, ruleIds))
    .groupBy(wafEvents.ruleId);
  return Object.fromEntries(
    rows.filter((r): r is typeof r & { ruleId: number } => r.ruleId != null)
        .map((r) => [r.ruleId, r.message ?? null])
  );
}

export async function listWafEvents(limit = 50, offset = 0, search?: string): Promise<WafEvent[]> {
  const rows = await db
    .select()
    .from(wafEvents)
    .where(buildSearch(search))
    .orderBy(desc(wafEvents.ts))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    host: r.host,
    clientIp: r.clientIp,
    countryCode: r.countryCode ?? null,
    method: r.method,
    uri: r.uri,
    ruleId: r.ruleId ?? null,
    ruleMessage: r.ruleMessage ?? null,
    severity: r.severity ?? null,
    rawData: r.rawData ?? null,
    blocked: r.blocked ?? true,
  }));
}
