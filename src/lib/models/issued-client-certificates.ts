import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { issuedClientCertificates } from "../db/schema";
import { desc, eq } from "drizzle-orm";

export type IssuedClientCertificate = {
  id: number;
  caCertificateId: number;
  commonName: string;
  serialNumber: string;
  fingerprintSha256: string;
  certificatePem: string;
  validFrom: string;
  validTo: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IssuedClientCertificateInput = {
  caCertificateId: number;
  commonName: string;
  serialNumber: string;
  fingerprintSha256: string;
  certificatePem: string;
  validFrom: string;
  validTo: string;
};

type IssuedClientCertificateRow = typeof issuedClientCertificates.$inferSelect;

function parseIssuedClientCertificate(row: IssuedClientCertificateRow): IssuedClientCertificate {
  return {
    id: row.id,
    caCertificateId: row.caCertificateId,
    commonName: row.commonName,
    serialNumber: row.serialNumber,
    fingerprintSha256: row.fingerprintSha256,
    certificatePem: row.certificatePem,
    validFrom: toIso(row.validFrom)!,
    validTo: toIso(row.validTo)!,
    revokedAt: toIso(row.revokedAt),
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
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
      caCertificateId: input.caCertificateId,
      commonName: input.commonName.trim(),
      serialNumber: input.serialNumber.trim(),
      fingerprintSha256: input.fingerprintSha256.trim(),
      certificatePem: input.certificatePem.trim(),
      validFrom: input.validFrom,
      validTo: input.validTo,
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
    summary: `Issued client certificate ${input.commonName}`,
    data: {
      caCertificateId: input.caCertificateId,
      serialNumber: input.serialNumber
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
  if (existing.revokedAt) {
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
    summary: `Revoked client certificate ${existing.commonName}`,
    data: {
      caCertificateId: existing.caCertificateId,
      serialNumber: existing.serialNumber
    }
  });
  await applyCaddyConfig();
  return (await getIssuedClientCertificate(id))!;
}
