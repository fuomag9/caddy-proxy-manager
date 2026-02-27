import db, { toIso, nowIso } from "../db";
import { auditEvents } from "../db/schema";
import { desc, ilike, or, count } from "drizzle-orm";

export type AuditEvent = {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string | null;
  created_at: string;
};

export async function countAuditEvents(search?: string): Promise<number> {
  const where = search
    ? or(
        ilike(auditEvents.summary, `%${search}%`),
        ilike(auditEvents.action, `%${search}%`),
        ilike(auditEvents.entityType, `%${search}%`)
      )
    : undefined;
  const [row] = await db.select({ value: count() }).from(auditEvents).where(where);
  return row?.value ?? 0;
}

export async function listAuditEvents(
  limit = 100,
  offset = 0,
  search?: string
): Promise<AuditEvent[]> {
  const where = search
    ? or(
        ilike(auditEvents.summary, `%${search}%`),
        ilike(auditEvents.action, `%${search}%`),
        ilike(auditEvents.entityType, `%${search}%`)
      )
    : undefined;
  const events = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return events.map((event) => ({
    id: event.id,
    user_id: event.userId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    summary: event.summary,
    created_at: toIso(event.createdAt)!,
  }));
}

export async function createAuditEvent(data: {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  summary?: string | null;
  data?: string | null;
}): Promise<void> {
  await db.insert(auditEvents).values({
    userId: data.userId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    summary: data.summary ?? null,
    data: data.data ?? null,
    createdAt: nowIso(),
  });
}
