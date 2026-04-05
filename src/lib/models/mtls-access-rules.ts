import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import { mtlsAccessRules } from "../db/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────

export type MtlsAccessRule = {
  id: number;
  proxy_host_id: number;
  path_pattern: string;
  allowed_role_ids: number[];
  allowed_cert_ids: number[];
  deny_all: boolean;
  priority: number;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export type MtlsAccessRuleInput = {
  proxy_host_id: number;
  path_pattern: string;
  allowed_role_ids?: number[];
  allowed_cert_ids?: number[];
  deny_all?: boolean;
  priority?: number;
  description?: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────

type RuleRow = typeof mtlsAccessRules.$inferSelect;

function parseJsonIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((n: unknown) => typeof n === "number" && Number.isFinite(n));
  } catch { /* ignore */ }
  return [];
}

function toMtlsAccessRule(row: RuleRow): MtlsAccessRule {
  return {
    id: row.id,
    proxy_host_id: row.proxyHostId,
    path_pattern: row.pathPattern,
    allowed_role_ids: parseJsonIds(row.allowedRoleIds),
    allowed_cert_ids: parseJsonIds(row.allowedCertIds),
    deny_all: row.denyAll,
    priority: row.priority,
    description: row.description,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listMtlsAccessRules(proxyHostId: number): Promise<MtlsAccessRule[]> {
  const rows = await db
    .select()
    .from(mtlsAccessRules)
    .where(eq(mtlsAccessRules.proxyHostId, proxyHostId))
    .orderBy(desc(mtlsAccessRules.priority), asc(mtlsAccessRules.pathPattern));
  return rows.map(toMtlsAccessRule);
}

export async function getMtlsAccessRule(id: number): Promise<MtlsAccessRule | null> {
  const row = await db.query.mtlsAccessRules.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  return row ? toMtlsAccessRule(row) : null;
}

export async function createMtlsAccessRule(
  input: MtlsAccessRuleInput,
  actorUserId: number
): Promise<MtlsAccessRule> {
  const now = nowIso();
  const [record] = await db
    .insert(mtlsAccessRules)
    .values({
      proxyHostId: input.proxy_host_id,
      pathPattern: input.path_pattern.trim(),
      allowedRoleIds: JSON.stringify(input.allowed_role_ids ?? []),
      allowedCertIds: JSON.stringify(input.allowed_cert_ids ?? []),
      denyAll: input.deny_all ?? false,
      priority: input.priority ?? 0,
      description: input.description ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!record) throw new Error("Failed to create mTLS access rule");

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "mtls_access_rule",
    entityId: record.id,
    summary: `Created mTLS access rule for path ${input.path_pattern} on proxy host ${input.proxy_host_id}`,
  });

  await applyCaddyConfig();
  return toMtlsAccessRule(record);
}

export async function updateMtlsAccessRule(
  id: number,
  input: Partial<Omit<MtlsAccessRuleInput, "proxy_host_id">>,
  actorUserId: number
): Promise<MtlsAccessRule> {
  const existing = await db.query.mtlsAccessRules.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  if (!existing) throw new Error("mTLS access rule not found");

  const now = nowIso();
  const updates: Partial<typeof mtlsAccessRules.$inferInsert> = { updatedAt: now };

  if (input.path_pattern !== undefined) updates.pathPattern = input.path_pattern.trim();
  if (input.allowed_role_ids !== undefined) updates.allowedRoleIds = JSON.stringify(input.allowed_role_ids);
  if (input.allowed_cert_ids !== undefined) updates.allowedCertIds = JSON.stringify(input.allowed_cert_ids);
  if (input.deny_all !== undefined) updates.denyAll = input.deny_all;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.description !== undefined) updates.description = input.description ?? null;

  await db.update(mtlsAccessRules).set(updates).where(eq(mtlsAccessRules.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "mtls_access_rule",
    entityId: id,
    summary: `Updated mTLS access rule for path ${input.path_pattern ?? existing.pathPattern}`,
  });

  await applyCaddyConfig();
  return (await getMtlsAccessRule(id))!;
}

export async function deleteMtlsAccessRule(
  id: number,
  actorUserId: number
): Promise<void> {
  const existing = await db.query.mtlsAccessRules.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  if (!existing) throw new Error("mTLS access rule not found");

  await db.delete(mtlsAccessRules).where(eq(mtlsAccessRules.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "mtls_access_rule",
    entityId: id,
    summary: `Deleted mTLS access rule for path ${existing.pathPattern}`,
  });

  await applyCaddyConfig();
}

/**
 * Bulk-query access rules for multiple proxy hosts at once.
 * Used during Caddy config generation.
 */
export async function getAccessRulesForHosts(
  proxyHostIds: number[]
): Promise<Map<number, MtlsAccessRule[]>> {
  if (proxyHostIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(mtlsAccessRules)
    .where(inArray(mtlsAccessRules.proxyHostId, proxyHostIds))
    .orderBy(desc(mtlsAccessRules.priority), asc(mtlsAccessRules.pathPattern));

  const map = new Map<number, MtlsAccessRule[]>();
  for (const row of rows) {
    const parsed = toMtlsAccessRule(row);
    let bucket = map.get(parsed.proxy_host_id);
    if (!bucket) {
      bucket = [];
      map.set(parsed.proxy_host_id, bucket);
    }
    bucket.push(parsed);
  }
  return map;
}
