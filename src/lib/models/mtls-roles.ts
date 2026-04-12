import db, { nowIso, toIso } from "../db";
import { applyCaddyConfig } from "../caddy";
import { logAuditEvent } from "../audit";
import {
  mtlsRoles,
  mtlsCertificateRoles,
  issuedClientCertificates,
} from "../db/schema";
import { asc, eq, inArray, count, and, isNull } from "drizzle-orm";
import { normalizeFingerprint } from "../caddy-mtls";

// ── Types ────────────────────────────────────────────────────────────

export type MtlsRole = {
  id: number;
  name: string;
  description: string | null;
  certificateCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MtlsRoleInput = {
  name: string;
  description?: string | null;
};

export type MtlsRoleWithCertificates = MtlsRole & {
  certificateIds: number[];
};

// ── Helpers ──────────────────────────────────────────────────────────

type RoleRow = typeof mtlsRoles.$inferSelect;

async function countCertsForRole(roleId: number): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(mtlsCertificateRoles)
    .where(eq(mtlsCertificateRoles.mtlsRoleId, roleId));
  return row?.value ?? 0;
}

function toMtlsRole(row: RoleRow, certCount: number): MtlsRole {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    certificateCount: certCount,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────

export async function listMtlsRoles(): Promise<MtlsRole[]> {
  const rows = await db.query.mtlsRoles.findMany({
    orderBy: (table) => asc(table.name),
  });
  if (rows.length === 0) return [];

  const roleIds = rows.map((r) => r.id);
  const counts = await db
    .select({
      roleId: mtlsCertificateRoles.mtlsRoleId,
      cnt: count(),
    })
    .from(mtlsCertificateRoles)
    .where(inArray(mtlsCertificateRoles.mtlsRoleId, roleIds))
    .groupBy(mtlsCertificateRoles.mtlsRoleId);

  const countMap = new Map(counts.map((c) => [c.roleId, c.cnt]));
  return rows.map((r) => toMtlsRole(r, countMap.get(r.id) ?? 0));
}

export async function getMtlsRole(id: number): Promise<MtlsRoleWithCertificates | null> {
  const row = await db.query.mtlsRoles.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  if (!row) return null;

  const assignments = await db
    .select({ certId: mtlsCertificateRoles.issuedClientCertificateId })
    .from(mtlsCertificateRoles)
    .where(eq(mtlsCertificateRoles.mtlsRoleId, id));

  return {
    ...toMtlsRole(row, assignments.length),
    certificateIds: assignments.map((a) => a.certId),
  };
}

export async function createMtlsRole(
  input: MtlsRoleInput,
  actorUserId: number
): Promise<MtlsRole> {
  const now = nowIso();
  const [record] = await db
    .insert(mtlsRoles)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!record) throw new Error("Failed to create mTLS role");

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "mtls_role",
    entityId: record.id,
    summary: `Created mTLS role ${input.name}`,
  });

  return toMtlsRole(record, 0);
}

export async function updateMtlsRole(
  id: number,
  input: Partial<MtlsRoleInput>,
  actorUserId: number
): Promise<MtlsRole> {
  const existing = await db.query.mtlsRoles.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  if (!existing) throw new Error("mTLS role not found");

  const now = nowIso();
  await db
    .update(mtlsRoles)
    .set({
      name: input.name?.trim() ?? existing.name,
      description: input.description !== undefined ? (input.description ?? null) : existing.description,
      updatedAt: now,
    })
    .where(eq(mtlsRoles.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "mtls_role",
    entityId: id,
    summary: `Updated mTLS role ${input.name?.trim() ?? existing.name}`,
  });

  await applyCaddyConfig();
  const certCount = await countCertsForRole(id);
  const updated = await db.query.mtlsRoles.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  return toMtlsRole(updated!, certCount);
}

export async function deleteMtlsRole(id: number, actorUserId: number): Promise<void> {
  const existing = await db.query.mtlsRoles.findFirst({
    where: (table, { eq: cmpEq }) => cmpEq(table.id, id),
  });
  if (!existing) throw new Error("mTLS role not found");

  await db.delete(mtlsRoles).where(eq(mtlsRoles.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "mtls_role",
    entityId: id,
    summary: `Deleted mTLS role ${existing.name}`,
  });

  await applyCaddyConfig();
}

// ── Certificate ↔ Role assignments ───────────────────────────────────

export async function assignRoleToCertificate(
  roleId: number,
  certId: number,
  actorUserId: number
): Promise<void> {
  const role = await db.query.mtlsRoles.findFirst({
    where: (t, { eq: cmpEq }) => cmpEq(t.id, roleId),
  });
  if (!role) throw new Error("mTLS role not found");

  const cert = await db.query.issuedClientCertificates.findFirst({
    where: (t, { eq: cmpEq }) => cmpEq(t.id, certId),
  });
  if (!cert) throw new Error("Issued client certificate not found");

  const now = nowIso();
  await db
    .insert(mtlsCertificateRoles)
    .values({
      issuedClientCertificateId: certId,
      mtlsRoleId: roleId,
      createdAt: now,
    });

  logAuditEvent({
    userId: actorUserId,
    action: "assign",
    entityType: "mtls_certificate_role",
    entityId: roleId,
    summary: `Assigned cert ${cert.commonName} to role ${role.name}`,
    data: { roleId, certId },
  });

  await applyCaddyConfig();
}

export async function removeRoleFromCertificate(
  roleId: number,
  certId: number,
  actorUserId: number
): Promise<void> {
  const role = await db.query.mtlsRoles.findFirst({
    where: (t, { eq: cmpEq }) => cmpEq(t.id, roleId),
  });
  if (!role) throw new Error("mTLS role not found");

  await db
    .delete(mtlsCertificateRoles)
    .where(
      and(
        eq(mtlsCertificateRoles.mtlsRoleId, roleId),
        eq(mtlsCertificateRoles.issuedClientCertificateId, certId)
      )
    );

  logAuditEvent({
    userId: actorUserId,
    action: "unassign",
    entityType: "mtls_certificate_role",
    entityId: roleId,
    summary: `Removed cert from role ${role.name}`,
    data: { roleId, certId },
  });

  await applyCaddyConfig();
}

export async function getCertificateRoles(certId: number): Promise<MtlsRole[]> {
  const assignments = await db
    .select({ roleId: mtlsCertificateRoles.mtlsRoleId })
    .from(mtlsCertificateRoles)
    .where(eq(mtlsCertificateRoles.issuedClientCertificateId, certId));

  if (assignments.length === 0) return [];

  const roleIds = assignments.map((a) => a.roleId);
  const rows = await db
    .select()
    .from(mtlsRoles)
    .where(inArray(mtlsRoles.id, roleIds))
    .orderBy(asc(mtlsRoles.name));

  return rows.map((r) => toMtlsRole(r, 0));
}

/**
 * Builds a map of roleId → Set<normalizedFingerprint> for all active (non-revoked) certs.
 * Used during Caddy config generation.
 */
export async function buildRoleFingerprintMap(): Promise<Map<number, Set<string>>> {
  const rows = await db
    .select({
      roleId: mtlsCertificateRoles.mtlsRoleId,
      fingerprint: issuedClientCertificates.fingerprintSha256,
    })
    .from(mtlsCertificateRoles)
    .innerJoin(
      issuedClientCertificates,
      eq(mtlsCertificateRoles.issuedClientCertificateId, issuedClientCertificates.id)
    )
    .where(isNull(issuedClientCertificates.revokedAt));

  const map = new Map<number, Set<string>>();
  for (const row of rows) {
    let set = map.get(row.roleId);
    if (!set) {
      set = new Set();
      map.set(row.roleId, set);
    }
    set.add(normalizeFingerprint(row.fingerprint));
  }
  return map;
}

/**
 * Builds a map of certId → normalizedFingerprint for all active (non-revoked) certs.
 * Used during Caddy config generation for direct cert overrides.
 */
export async function buildCertFingerprintMap(): Promise<Map<number, string>> {
  const rows = await db
    .select({
      id: issuedClientCertificates.id,
      fingerprint: issuedClientCertificates.fingerprintSha256,
    })
    .from(issuedClientCertificates)
    .where(isNull(issuedClientCertificates.revokedAt));

  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.id, normalizeFingerprint(row.fingerprint));
  }
  return map;
}

/**
 * Builds a map of roleId → Set<certId> for all active (non-revoked) certs.
 * Used during Caddy config generation to resolve trusted_role_ids → cert IDs.
 */
export async function buildRoleCertIdMap(): Promise<Map<number, Set<number>>> {
  const rows = await db
    .select({
      roleId: mtlsCertificateRoles.mtlsRoleId,
      certId: mtlsCertificateRoles.issuedClientCertificateId,
    })
    .from(mtlsCertificateRoles)
    .innerJoin(
      issuedClientCertificates,
      eq(mtlsCertificateRoles.issuedClientCertificateId, issuedClientCertificates.id)
    )
    .where(isNull(issuedClientCertificates.revokedAt));

  const map = new Map<number, Set<number>>();
  for (const row of rows) {
    let set = map.get(row.roleId);
    if (!set) {
      set = new Set();
      map.set(row.roleId, set);
    }
    set.add(row.certId);
  }
  return map;
}

// normalizeFingerprint is imported from caddy-mtls.ts (the canonical location)
// and re-exported for convenience.
export { normalizeFingerprint } from "../caddy-mtls";
