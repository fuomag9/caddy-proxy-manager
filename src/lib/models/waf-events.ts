import db from "../db";
import { wafEvents } from "../db/schema";
import { desc, like, or, count, and } from "drizzle-orm";

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
  }));
}
