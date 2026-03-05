import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { caCertificates, proxyHosts } from "../db/schema";
import { desc, eq } from "drizzle-orm";

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
  certificate_pem: string;
  created_at: string;
  updated_at: string;
};

export type CaCertificateInput = {
  name: string;
  certificate_pem: string;
};

type CaCertificateRow = typeof caCertificates.$inferSelect;

function parseCaCertificate(row: CaCertificateRow): CaCertificate {
  return {
    id: row.id,
    name: row.name,
    certificate_pem: row.certificatePem,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!
  };
}

export async function listCaCertificates(): Promise<CaCertificate[]> {
  const rows = await db.select().from(caCertificates).orderBy(desc(caCertificates.createdAt));
  return rows.map(parseCaCertificate);
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
      certificatePem: input.certificate_pem.trim(),
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
      certificatePem: input.certificate_pem?.trim() ?? existing.certificate_pem,
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

  // Check if any proxy hosts reference this CA cert
  const allHosts = await db.select({ meta: proxyHosts.meta, name: proxyHosts.name }).from(proxyHosts);
  const referencing = allHosts.filter((host) => {
    const meta = tryParseJson<{ mtls?: { enabled?: boolean; ca_certificate_ids?: number[] } }>(host.meta, {});
    return meta.mtls?.enabled && meta.mtls.ca_certificate_ids?.includes(id);
  });

  if (referencing.length > 0) {
    const names = referencing.map((h) => h.name).join(", ");
    throw new Error(`CA certificate is in use by proxy host(s): ${names}`);
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
