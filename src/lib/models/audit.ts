import db, { toIso } from "../db";
import { auditEvents } from "../db/schema";
import { desc } from "drizzle-orm";

export type AuditEvent = {
  id: number;
  user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  summary: string | null;
  created_at: string;
};

export async function listAuditEvents(limit = 100): Promise<AuditEvent[]> {
  const events = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  return events.map((event) => ({
    id: event.id,
    user_id: event.userId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    summary: event.summary,
    created_at: toIso(event.createdAt)!
  }));
}
