import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { caCertificates, issuedClientCertificates, mtlsCertificateRoles, proxyHosts } from "../db/schema";
import { desc, eq, inArray } from "drizzle-orm";

function tryParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export type CaCertificate = {
  id: number;
  name: string;
  certificatePem: string;
  hasPrivateKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CaCertificateInput = {
  name: string;
  certificatePem: string;
  privateKeyPem?: string;
};

type CaCertificateRow = typeof caCertificates.$inferSelect;

function parseCaCertificate(row: CaCertificateRow): CaCertificate {
  return {
    id: row.id,
    name: row.name,
    certificatePem: row.certificatePem,
    hasPrivateKey: !!row.privateKeyPem,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listCaCertificates(): Promise<CaCertificate[]> {
  const rows = await db.select().from(caCertificates).orderBy(desc(caCertificates.createdAt));
  return rows.map(parseCaCertificate);
}

export async function getCaCertificatePrivateKey(id: number): Promise<string | null> {
  const cert = await db.query.caCertificates.findFirst({
    where: (table, { eq }) => eq(table.id, id)
  });
  return cert?.privateKeyPem ?? null;
}

export async function getCaCertificate(id: number): Promise<CaCertificate | null> {
  const cert = await db.query.caCertificates.findFirst({
    where: (table, { eq }) => eq(table.id, id)
  });
  return cert ? parseCaCertificate(cert) : null;
}

export async function createCaCertificate(input: CaCertificateInput, actorUserId: number): Promise<CaCertificate> {
  const now = nowIso();
  const [record] = await db
    .insert(caCertificates)
    .values({
      name: input.name.trim(),
      certificatePem: input.certificatePem.trim(),
      privateKeyPem: input.privateKeyPem?.trim() ?? null,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create CA certificate");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "ca_certificate",
    entityId: record.id,
    summary: `Created CA certificate ${input.name}`
  });
  await applyCaddyConfig();
  return (await getCaCertificate(record.id))!;
}

export async function updateCaCertificate(id: number, input: Partial<CaCertificateInput>, actorUserId: number): Promise<CaCertificate> {
  const existing = await getCaCertificate(id);
  if (!existing) {
    throw new Error("CA certificate not found");
  }

  const now = nowIso();
  await db
    .update(caCertificates)
    .set({
      name: input.name?.trim() ?? existing.name,
      certificatePem: input.certificatePem?.trim() ?? existing.certificatePem,
      ...(input.privateKeyPem !== undefined ? { privateKeyPem: input.privateKeyPem?.trim() ?? null } : {}),
      updatedAt: now
    })
    .where(eq(caCertificates.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "ca_certificate",
    entityId: id,
    summary: `Updated CA certificate ${input.name ?? existing.name}`
  });
  await applyCaddyConfig();
  return (await getCaCertificate(id))!;
}

export async function deleteCaCertificate(id: number, actorUserId: number): Promise<void> {
  const existing = await getCaCertificate(id);
  if (!existing) {
    throw new Error("CA certificate not found");
  }

  // Collect the issued client certificates belonging to this CA, plus any
  // mTLS roles that include them — used both to detect references below and to
  // cascade-delete afterwards.
  const issuedCerts = await db
    .select({ id: issuedClientCertificates.id })
    .from(issuedClientCertificates)
    .where(eq(issuedClientCertificates.caCertificateId, id));
  const issuedCertIds = issuedCerts.map((c) => c.id);
  const issuedCertIdSet = new Set(issuedCertIds);

  const affectedRoleIds = new Set<number>();
  if (issuedCertIds.length > 0) {
    const roleRows = await db
      .select({ roleId: mtlsCertificateRoles.mtlsRoleId })
      .from(mtlsCertificateRoles)
      .where(inArray(mtlsCertificateRoles.issuedClientCertificateId, issuedCertIds));
    for (const row of roleRows) affectedRoleIds.add(row.roleId);
  }

  // Check if any proxy host's mTLS config references this CA. A host is "in
  // use" if it directly trusts one of the CA's issued certs
  // (trusted_client_cert_ids), trusts a role that contains one
  // (trusted_role_ids), or uses the deprecated whole-CA trust list
  // (ca_certificate_ids). The old guard only checked the deprecated field, so
  // CAs trusted via the current per-cert/role model could be deleted out from
  // under a live host.
  const allHosts = await db.select({ meta: proxyHosts.meta, name: proxyHosts.name }).from(proxyHosts);
  const referencing = allHosts.filter((host) => {
    const meta = tryParseJson<{
      mtls?: {
        enabled?: boolean;
        trusted_client_cert_ids?: number[];
        trusted_role_ids?: number[];
        ca_certificate_ids?: number[];
      };
    }>(host.meta, {});
    if (!meta.mtls?.enabled) return false;
    const trustsCert = meta.mtls.trusted_client_cert_ids?.some((cid) => issuedCertIdSet.has(cid)) ?? false;
    const trustsRole = meta.mtls.trusted_role_ids?.some((rid) => affectedRoleIds.has(rid)) ?? false;
    const trustsCa = meta.mtls.ca_certificate_ids?.includes(id) ?? false;
    return trustsCert || trustsRole || trustsCa;
  });

  if (referencing.length > 0) {
    const names = referencing.map((h) => h.name).join(", ");
    throw new Error(`CA certificate is in use by proxy host(s): ${names}`);
  }

  // Cascade-delete the CA's issued client certificates and their role
  // mappings. The schema declares onDelete: "cascade" for these foreign keys,
  // but better-sqlite3 leaves PRAGMA foreign_keys OFF, so the cascade never
  // fires automatically — without this, deleting a CA orphans its issued
  // certificates, which keep appearing as selectable in the mTLS picker.
  if (issuedCertIds.length > 0) {
    await db
      .delete(mtlsCertificateRoles)
      .where(inArray(mtlsCertificateRoles.issuedClientCertificateId, issuedCertIds));
    await db
      .delete(issuedClientCertificates)
      .where(eq(issuedClientCertificates.caCertificateId, id));
  }

  await db.delete(caCertificates).where(eq(caCertificates.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "ca_certificate",
    entityId: id,
    summary: `Deleted CA certificate ${existing.name}`
  });
  await applyCaddyConfig();
}
