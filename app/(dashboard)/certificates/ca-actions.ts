"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { createCaCertificate, deleteCaCertificate, updateCaCertificate, getCaCertificatePrivateKey } from "@/src/lib/models/ca-certificates";
import { createIssuedClientCertificate, revokeIssuedClientCertificate } from "@/src/lib/models/issued-client-certificates";
import { X509Certificate } from "node:crypto";
import forge from "node-forge";

function validatePem(pem: string): void {
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error("Invalid certificate PEM: could not parse as X.509 certificate");
  }
}

export async function createCaCertificateAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = String(formData.get("name") ?? "").trim();
  const certificatePem = String(formData.get("certificate_pem") ?? "").trim();

  if (!name) throw new Error("Name is required");
  if (!certificatePem) throw new Error("Certificate PEM is required");
  validatePem(certificatePem);

  await createCaCertificate({ name, certificate_pem: certificatePem }, userId);
  revalidatePath("/certificates");
}

export async function updateCaCertificateAction(id: number, formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = formData.get("name") ? String(formData.get("name")).trim() : undefined;
  const certificatePem = formData.get("certificate_pem") ? String(formData.get("certificate_pem")).trim() : undefined;

  if (certificatePem) {
    validatePem(certificatePem);
  }

  await updateCaCertificate(id, {
    ...(name ? { name } : {}),
    ...(certificatePem ? { certificate_pem: certificatePem } : {})
  }, userId);
  revalidatePath("/certificates");
}

export async function deleteCaCertificateAction(id: number): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  try {
    await deleteCaCertificate(id, userId);
    revalidatePath("/certificates");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Failed to delete CA certificate" };
  }
}

export async function generateCaCertificateAction(formData: FormData): Promise<{ id: number }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const name = String(formData.get("name") ?? "").trim();
  const commonName = String(formData.get("common_name") ?? name).trim() || name;
  const validityDays = Math.min(3650, Math.max(1, parseInt(String(formData.get("validity_days") ?? "3650"), 10) || 3650));

  if (!name) throw new Error("Name is required");

  const keypair = forge.pki.rsa.generateKeyPair({ bits: 4096 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + validityDays);

  const attrs = [
    { name: "commonName", value: commonName },
    { name: "organizationName", value: "Caddy Proxy Manager" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);

  cert.sign(keypair.privateKey, forge.md.sha256.create());

  const certificatePem = forge.pki.certificateToPem(cert);
  const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

  const record = await createCaCertificate({ name, certificate_pem: certificatePem, private_key_pem: privateKeyPem }, userId);
  revalidatePath("/certificates");
  return { id: record.id };
}

export type IssuedClientCert = {
  pkcs12Base64: string;
  passwordProtected: boolean;
  exportAlgorithm: "3des" | "aes256";
};

export async function issueClientCertificateAction(
  caCertId: number,
  formData: FormData
): Promise<IssuedClientCert> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const commonName = String(formData.get("common_name") ?? "").trim();
  const validityDays = Math.min(3650, Math.max(1, parseInt(String(formData.get("validity_days") ?? "365"), 10) || 365));
  const exportPassword = String(formData.get("export_password") ?? "");
  const compatibilityMode = formData.get("compatibility_mode") === "on";
  const exportAlgorithm: IssuedClientCert["exportAlgorithm"] = compatibilityMode ? "3des" : "aes256";

  if (!commonName) throw new Error("Common name is required");
  if (!exportPassword) throw new Error("Export password is required");

  const caPrivateKeyPem = await getCaCertificatePrivateKey(caCertId);
  if (!caPrivateKeyPem) throw new Error("This CA has no stored private key — cannot issue client certificates");

  const caCertRecord = await import("@/src/lib/models/ca-certificates").then(m => m.getCaCertificate(caCertId));
  if (!caCertRecord) throw new Error("CA certificate not found");

  const caKey = forge.pki.privateKeyFromPem(caPrivateKeyPem);
  const caCert = forge.pki.certificateFromPem(caCertRecord.certificate_pem);

  const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keypair.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + validityDays);

  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", clientAuth: true },
  ]);

  cert.sign(caKey, forge.md.sha256.create());
  const certificatePem = forge.pki.certificateToPem(cert);
  const certificate = new X509Certificate(certificatePem);

  await createIssuedClientCertificate(
    {
      ca_certificate_id: caCertId,
      common_name: commonName,
      serial_number: cert.serialNumber.toUpperCase(),
      fingerprint_sha256: certificate.fingerprint256,
      certificate_pem: certificatePem,
      valid_from: new Date(certificate.validFrom).toISOString(),
      valid_to: new Date(certificate.validTo).toISOString()
    },
    userId
  );
  revalidatePath("/certificates");

  const pkcs12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keypair.privateKey,
    [cert, caCert],
    exportPassword,
    {
      algorithm: exportAlgorithm,
      friendlyName: commonName,
    }
  );
  const pkcs12Der = forge.asn1.toDer(pkcs12Asn1).getBytes();

  return {
    pkcs12Base64: forge.util.encode64(pkcs12Der),
    passwordProtected: true,
    exportAlgorithm,
  };
}

export async function revokeIssuedClientCertificateAction(id: number): Promise<{ revokedAt: string }> {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const record = await revokeIssuedClientCertificate(id, userId);
  revalidatePath("/certificates");
  return { revokedAt: record.revoked_at! };
}
