import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { issuedClientCertificates } from "../db/schema";
import { desc, eq } from "drizzle-orm";

export type IssuedClientCertificate = {
  id: number;
  ca_certificate_id: number;
  common_name: string;
  serial_number: string;
  fingerprint_sha256: string;
  certificate_pem: string;
  valid_from: string;
  valid_to: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IssuedClientCertificateInput = {
  ca_certificate_id: number;
  common_name: string;
  serial_number: string;
  fingerprint_sha256: string;
  certificate_pem: string;
  valid_from: string;
  valid_to: string;
};

type IssuedClientCertificateRow = typeof issuedClientCertificates.$inferSelect;

function parseIssuedClientCertificate(row: IssuedClientCertificateRow): IssuedClientCertificate {
  return {
    id: row.id,
    ca_certificate_id: row.caCertificateId,
    common_name: row.commonName,
    serial_number: row.serialNumber,
    fingerprint_sha256: row.fingerprintSha256,
    certificate_pem: row.certificatePem,
    valid_from: toIso(row.validFrom)!,
    valid_to: toIso(row.validTo)!,
    revoked_at: toIso(row.revokedAt),
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!
  };
}

export async function listIssuedClientCertificates(): Promise<IssuedClientCertificate[]> {
  const rows = await db
    .select()
    .from(issuedClientCertificates)
    .orderBy(desc(issuedClientCertificates.createdAt));
  return rows.map(parseIssuedClientCertificate);
}

export async function getIssuedClientCertificate(id: number): Promise<IssuedClientCertificate | null> {
  const record = await db.query.issuedClientCertificates.findFirst({
    where: (table, { eq: compareEq }) => compareEq(table.id, id)
  });
  return record ? parseIssuedClientCertificate(record) : null;
}

export async function createIssuedClientCertificate(
  input: IssuedClientCertificateInput,
  actorUserId: number
): Promise<IssuedClientCertificate> {
  const now = nowIso();
  const [record] = await db
    .insert(issuedClientCertificates)
    .values({
      caCertificateId: input.ca_certificate_id,
      commonName: input.common_name.trim(),
      serialNumber: input.serial_number.trim(),
      fingerprintSha256: input.fingerprint_sha256.trim(),
      certificatePem: input.certificate_pem.trim(),
      validFrom: input.valid_from,
      validTo: input.valid_to,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  if (!record) {
    throw new Error("Failed to store issued client certificate");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "issued_client_certificate",
    entityId: record.id,
    summary: `Issued client certificate ${input.common_name}`,
    data: {
      caCertificateId: input.ca_certificate_id,
      serialNumber: input.serial_number
    }
  });
  await applyCaddyConfig();
  return (await getIssuedClientCertificate(record.id))!;
}

export async function revokeIssuedClientCertificate(
  id: number,
  actorUserId: number
): Promise<IssuedClientCertificate> {
  const existing = await getIssuedClientCertificate(id);
  if (!existing) {
    throw new Error("Issued client certificate not found");
  }
  if (existing.revoked_at) {
    throw new Error("Issued client certificate is already revoked");
  }

  const revokedAt = nowIso();
  await db
    .update(issuedClientCertificates)
    .set({
      revokedAt,
      updatedAt: revokedAt
    })
    .where(eq(issuedClientCertificates.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "revoke",
    entityType: "issued_client_certificate",
    entityId: id,
    summary: `Revoked client certificate ${existing.common_name}`,
    data: {
      caCertificateId: existing.ca_certificate_id,
      serialNumber: existing.serial_number
    }
  });
  await applyCaddyConfig();
  return (await getIssuedClientCertificate(id))!;
}
