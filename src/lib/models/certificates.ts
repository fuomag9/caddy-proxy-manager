import db, { nowIso, toIso } from "../db";
import { logAuditEvent } from "../audit";
import { applyCaddyConfig } from "../caddy";
import { certificates } from "../db/schema";
import { desc, eq } from "drizzle-orm";

export type CertificateType = "managed" | "imported";

export type Certificate = {
  id: number;
  name: string;
  type: CertificateType;
  domainNames: string[];
  autoRenew: boolean;
  providerOptions: Record<string, unknown> | null;
  certificatePem: string | null;
  privateKeyPem: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CertificateInput = {
  name: string;
  type: CertificateType;
  domainNames: string[];
  autoRenew?: boolean;
  providerOptions?: Record<string, unknown> | null;
  certificatePem?: string | null;
  privateKeyPem?: string | null;
};

type CertificateRow = typeof certificates.$inferSelect;

function parseCertificate(row: CertificateRow): Certificate {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CertificateType,
    domainNames: JSON.parse(row.domainNames),
    autoRenew: row.autoRenew,
    providerOptions: row.providerOptions ? JSON.parse(row.providerOptions) : null,
    certificatePem: row.certificatePem,
    privateKeyPem: row.privateKeyPem,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listCertificates(): Promise<Certificate[]> {
  const rows = await db.select().from(certificates).orderBy(desc(certificates.createdAt));
  return rows.map(parseCertificate);
}

export async function getCertificate(id: number): Promise<Certificate | null> {
  const cert = await db.query.certificates.findFirst({
    where: (table, { eq }) => eq(table.id, id)
  });
  return cert ? parseCertificate(cert) : null;
}

function validateCertificateInput(input: CertificateInput) {
  if (!input.domainNames || input.domainNames.length === 0) {
    throw new Error("At least one domain is required for a certificate");
  }
  if (input.type === "imported") {
    if (!input.certificatePem || !input.privateKeyPem) {
      throw new Error("Imported certificates require certificate and key PEM data");
    }
  }
}

export async function createCertificate(input: CertificateInput, actorUserId: number) {
  validateCertificateInput(input);
  const now = nowIso();
  const [record] = await db
    .insert(certificates)
    .values({
      name: input.name.trim(),
      type: input.type,
      domainNames: JSON.stringify(
        Array.from(new Set(input.domainNames.map((domain) => domain.trim().toLowerCase())))
      ),
      autoRenew: input.autoRenew ?? true,
      providerOptions: input.providerOptions ? JSON.stringify(input.providerOptions) : null,
      certificatePem: input.certificatePem ?? null,
      privateKeyPem: input.privateKeyPem ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUserId
    })
    .returning();

  if (!record) {
    throw new Error("Failed to create certificate");
  }

  logAuditEvent({
    userId: actorUserId,
    action: "create",
    entityType: "certificate",
    entityId: record.id,
    summary: `Created certificate ${input.name}`
  });
  await applyCaddyConfig();
  return (await getCertificate(record.id))!;
}

export async function updateCertificate(id: number, input: Partial<CertificateInput>, actorUserId: number) {
  const existing = await getCertificate(id);
  if (!existing) {
    throw new Error("Certificate not found");
  }

  const merged: CertificateInput = {
    name: input.name ?? existing.name,
    type: input.type ?? existing.type,
    domainNames: input.domainNames ?? existing.domainNames,
    autoRenew: input.autoRenew ?? existing.autoRenew,
    providerOptions: input.providerOptions ?? existing.providerOptions,
    certificatePem: input.certificatePem ?? existing.certificatePem,
    privateKeyPem: input.privateKeyPem ?? existing.privateKeyPem
  };

  validateCertificateInput(merged);

  const now = nowIso();
  await db
    .update(certificates)
    .set({
      name: merged.name.trim(),
      type: merged.type,
      domainNames: JSON.stringify(Array.from(new Set(merged.domainNames))),
      autoRenew: merged.autoRenew,
      providerOptions: merged.providerOptions ? JSON.stringify(merged.providerOptions) : null,
      certificatePem: merged.certificatePem ?? null,
      privateKeyPem: merged.privateKeyPem ?? null,
      updatedAt: now
    })
    .where(eq(certificates.id, id));

  logAuditEvent({
    userId: actorUserId,
    action: "update",
    entityType: "certificate",
    entityId: id,
    summary: `Updated certificate ${merged.name}`
  });
  await applyCaddyConfig();
  return (await getCertificate(id))!;
}

export async function deleteCertificate(id: number, actorUserId: number) {
  const existing = await getCertificate(id);
  if (!existing) {
    throw new Error("Certificate not found");
  }

  await db.delete(certificates).where(eq(certificates.id, id));
  logAuditEvent({
    userId: actorUserId,
    action: "delete",
    entityType: "certificate",
    entityId: id,
    summary: `Deleted certificate ${existing.name}`
  });
  await applyCaddyConfig();
}
