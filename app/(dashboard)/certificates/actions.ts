"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/lib/auth";
import { createCertificate, deleteCertificate, updateCertificate } from "@/src/lib/models/certificates";

function parseDomains(value: FormDataEntryValue | null): string[] {
  if (!value || typeof value !== "string") {
    return [];
  }
  return value
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function createCertificateAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const type = String(formData.get("type") ?? "managed") as "managed" | "imported";
  await createCertificate(
    {
      name: String(formData.get("name") ?? "Certificate"),
      type,
      domainNames: parseDomains(formData.get("domain_names")),
      autoRenew: type === "managed" ? formData.get("auto_renew") === "on" : false,
      certificatePem: type === "imported" ? String(formData.get("certificate_pem") ?? "") : null,
      privateKeyPem: type === "imported" ? String(formData.get("private_key_pem") ?? "") : null
    },
    userId
  );
  revalidatePath("/certificates");
}

export async function updateCertificateAction(id: number, formData: FormData) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  const type = formData.get("type") ? (String(formData.get("type")) as "managed" | "imported") : undefined;
  await updateCertificate(
    id,
    {
      name: formData.get("name") ? String(formData.get("name")) : undefined,
      type,
      domainNames: formData.get("domain_names") ? parseDomains(formData.get("domain_names")) : undefined,
      autoRenew: formData.has("auto_renew_present") ? formData.get("auto_renew") === "on" : undefined,
      certificatePem: formData.get("certificate_pem") ? String(formData.get("certificate_pem")) : undefined,
      privateKeyPem: formData.get("private_key_pem") ? String(formData.get("private_key_pem")) : undefined
    },
    userId
  );
  revalidatePath("/certificates");
}

export async function deleteCertificateAction(id: number) {
  const session = await requireAdmin();
  const userId = Number(session.user.id);
  await deleteCertificate(id, userId);
  revalidatePath("/certificates");
}
