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
  domain_names: string[];
  auto_renew: boolean;
  provider_options: Record<string, unknown> | null;
  certificate_pem: string | null;
  private_key_pem: string | null;
  created_at: string;
  updated_at: string;
};

export type CertificateInput = {
  name: string;
  type: CertificateType;
  domain_names: string[];
  auto_renew?: boolean;
  provider_options?: Record<string, unknown> | null;
  certificate_pem?: string | null;
  private_key_pem?: string | null;
};

type CertificateRow = typeof certificates.$inferSelect;

function parseCertificate(row: CertificateRow): Certificate {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CertificateType,
    domain_names: JSON.parse(row.domainNames),
    auto_renew: row.autoRenew,
    provider_options: row.providerOptions ? JSON.parse(row.providerOptions) : null,
    certificate_pem: row.certificatePem,
    private_key_pem: row.privateKeyPem,
    created_at: toIso(row.createdAt)!,
    updated_at: toIso(row.updatedAt)!
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
  if (!input.domain_names || input.domain_names.length === 0) {
    throw new Error("At least one domain is required for a certificate");
  }
  if (input.type === "imported") {
    if (!input.certificate_pem || !input.private_key_pem) {
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
        Array.from(new Set(input.domain_names.map((domain) => domain.trim().toLowerCase())))
      ),
      autoRenew: input.auto_renew ?? true,
      providerOptions: input.provider_options ? JSON.stringify(input.provider_options) : null,
      certificatePem: input.certificate_pem ?? null,
      privateKeyPem: input.private_key_pem ?? null,
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
    domain_names: input.domain_names ?? existing.domain_names,
    auto_renew: input.auto_renew ?? existing.auto_renew,
    provider_options: input.provider_options ?? existing.provider_options,
    certificate_pem: input.certificate_pem ?? existing.certificate_pem,
    private_key_pem: input.private_key_pem ?? existing.private_key_pem
  };

  validateCertificateInput(merged);

  const now = nowIso();
  await db
    .update(certificates)
    .set({
      name: merged.name.trim(),
      type: merged.type,
      domainNames: JSON.stringify(Array.from(new Set(merged.domain_names))),
      autoRenew: merged.auto_renew,
      providerOptions: merged.provider_options ? JSON.stringify(merged.provider_options) : null,
      certificatePem: merged.certificate_pem ?? null,
      privateKeyPem: merged.private_key_pem ?? null,
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
