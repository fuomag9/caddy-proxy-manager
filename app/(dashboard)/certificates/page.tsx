import CertificatesClient from "./CertificatesClient";
import { listCertificates } from "@/src/lib/models/certificates";
import { requireAdmin } from "@/src/lib/auth";

export default async function CertificatesPage() {
  await requireAdmin();
  const certificates = await listCertificates();
  return <CertificatesClient certificates={certificates} />;
}
