import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { deadHosts } from "../db/schema";
import { desc, eq } from "drizzle-orm";

export type DeadHost = {
  id: number;
  name: string;
  domains: string[];
  status_code: number;
  response_body: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type DeadHostInput = {
  name: string;
  domains: string[];
  status_code?: number;
  response_body?: string | null;
  enabled?: boolean;
};

type DeadHostRow = typeof deadHosts.$inferSelect;

function parse(row: DeadHostRow): DeadHost {
  return {
    id: row.id,
    name: row.name,
    domains: JSON.parse(row.domains),
    status_code: row.statusCode,
    response_body: row.responseBody,
    enabled: row.enabled,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!
  };
}

export async function listDeadHosts(): Promise<DeadHost[]> {
  const hosts = await db.select().from(deadHosts).orderBy(desc(deadHosts.createdAt));
  return hosts.map(parse);
}

export async function getDeadHost(id: number): Promise<DeadHost | null> {
  const host = await db.query.deadHosts.findFirst({
    where: (table, { eq }) => eq(table.id, id)
  });
  return host ? parse(host) : null;
}

export async function createDeadHost(input: DeadHostInput, actorUserId: number) {
  if (!input.domains || input.domains.length === 0) {
    throw new Error("At least one domain is required");
  }

  const now = nowIso();
  const [record] = await db
    .insert(deadHosts)
    .values({
      name: input.name.trim(),
      domains: JSON.stringify(Array.from(new Set(input.domains.map((d) => d.trim().toLowerCase())))),
      statusCode: input.status_code ?? 503,
      responseBody: input.response_body ?? null,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create dead host");
  }
  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "dead_host",
    entityId: record.id,
    summary: `Created dead host ${input.name}`
  });
  await applyCaddyConfig();
  return (await getDeadHost(record.id))!;
}

export async function updateDeadHost(id: number, input: Partial<DeadHostInput>, actorUserId: number) {
  const existing = await getDeadHost(id);
  if (!existing) {
    throw new Error("Dead host not found");
  }
  const now = nowIso();
  await db
    .update(deadHosts)
    .set({
      name: input.name ?? existing.name,
      domains: JSON.stringify(input.domains ? Array.from(new Set(input.domains)) : existing.domains),
      statusCode: input.status_code ?? existing.status_code,
      responseBody: input.response_body ?? existing.response_body,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: now
    })
    .where(eq(deadHosts.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "dead_host",
    entityId: id,
    summary: `Updated dead host ${input.name ?? existing.name}`
  });
  await applyCaddyConfig();
  return (await getDeadHost(id))!;
}

export async function deleteDeadHost(id: number, actorUserId: number) {
  const existing = await getDeadHost(id);
  if (!existing) {
    throw new Error("Dead host not found");
  }
  await db.delete(deadHosts).where(eq(deadHosts.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "dead_host",
    entityId: id,
    summary: `Deleted dead host ${existing.name}`
  });
  await applyCaddyConfig();
}
