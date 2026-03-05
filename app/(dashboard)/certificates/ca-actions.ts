"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { createCaCertificate, deleteCaCertificate, updateCaCertificate, getCaCertificatePrivateKey } from "@/src/lib/models/ca-certificates";
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

export async function deleteCaCertificateAction(id: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await deleteCaCertificate(id, userId);
  revalidatePath("/certificates");
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
  certificatePem: string;
  privateKeyPem: string;
};

export async function issueClientCertificateAction(
  caCertId: number,
  formData: FormData
): Promise<IssuedClientCert> {
  await requireAdmin();
  const commonName = String(formData.get("common_name") ?? "").trim();
  const validityDays = Math.min(3650, Math.max(1, parseInt(String(formData.get("validity_days") ?? "365"), 10) || 365));

  if (!commonName) throw new Error("Common name is required");

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

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(keypair.privateKey),
  };
}
