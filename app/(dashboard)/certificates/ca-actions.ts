"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { createCaCertificate, deleteCaCertificate, updateCaCertificate } from "@/src/lib/models/ca-certificates";
import { X509Certificate } from "node:crypto";

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
