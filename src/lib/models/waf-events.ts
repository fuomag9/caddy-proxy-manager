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
  }));
}
