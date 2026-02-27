import { X509Certificate } from 'node:crypto';
import db from '@/src/lib/db';
import { proxyHosts, certificates } from '@/src/lib/db/schema';
import { isNull, isNotNull } from 'drizzle-orm';
import { requireAdmin } from '@/src/lib/auth';
import CertificatesClient from './CertificatesClient';
import { scanAcmeCerts } from '@/src/lib/acme-certs';

export type CertExpiryStatus = 'ok' | 'expiring_soon' | 'expired';

export type AcmeHost = {
  id: number;
  name: string;
  domains: string[];
  ssl_forced: boolean;
  enabled: boolean;
  certValidTo: string | null;
  certValidFrom: string | null;
  certIssuer: string | null;
  certExpiryStatus: CertExpiryStatus | null;
};

export type ImportedCertView = {
  id: number;
  name: string;
  domains: string[];
  validTo: string | null;
  validFrom: string | null;
  issuer: string | null;
  expiryStatus: CertExpiryStatus | null;
  usedBy: { id: number; name: string; domains: string[] }[];
};

export type ManagedCertView = { id: number; name: string; domain_names: string[] };

function parsePemInfo(pem: string): { validTo: string; validFrom: string; issuer: string; sanDomains: string[] } | null {
  try {
    const c = new X509Certificate(pem);
    const sanDomains =
      c.subjectAltName
        ?.split(',')
        .map(s => s.trim())
        .filter(s => s.startsWith('DNS:'))
        .map(s => s.slice(4)) ?? [];
    const issuerLine = c.issuer ?? '';
    const issuer = (
      issuerLine.match(/O=([^\n,]+)/)?.[1] ??
      issuerLine.match(/CN=([^\n,]+)/)?.[1] ??
      issuerLine
    ).trim();
    return {
      validTo: new Date(c.validTo).toISOString(),
      validFrom: new Date(c.validFrom).toISOString(),
      issuer,
      sanDomains,
    };
  } catch {
    return null;
  }
}

function getExpiryStatus(validToIso: string): CertExpiryStatus {
  const diff = new Date(validToIso).getTime() - Date.now();
  if (diff < 0) return 'expired';
  if (diff < 30 * 86400 * 1000) return 'expiring_soon';
  return 'ok';
}

export default async function CertificatesPage() {
  await requireAdmin();
  const acmeCertMap = scanAcmeCerts();

  const [acmeRows, certRows, usageRows] = await Promise.all([
    db
      .select({
        id: proxyHosts.id,
        name: proxyHosts.name,
        domains: proxyHosts.domains,
        sslForced: proxyHosts.sslForced,
        enabled: proxyHosts.enabled,
      })
      .from(proxyHosts)
      .where(isNull(proxyHosts.certificateId)),
    db.select().from(certificates),
    db
      .select({
        certId: proxyHosts.certificateId,
        hostId: proxyHosts.id,
        hostName: proxyHosts.name,
        hostDomains: proxyHosts.domains,
      })
      .from(proxyHosts)
      .where(isNotNull(proxyHosts.certificateId)),
  ]);

  const acmeHosts: AcmeHost[] = acmeRows.map(r => {
    const domains = JSON.parse(r.domains) as string[];
    let certInfo = null;
    for (const domain of domains) {
      const info = acmeCertMap.get(domain.toLowerCase());
      if (info) { certInfo = info; break; }
    }
    return {
      id: r.id,
      name: r.name,
      domains,
      ssl_forced: r.sslForced,
      enabled: r.enabled,
      certValidTo: certInfo?.validTo ?? null,
      certValidFrom: certInfo?.validFrom ?? null,
      certIssuer: certInfo?.issuer ?? null,
      certExpiryStatus: certInfo?.validTo ? getExpiryStatus(certInfo.validTo) : null,
    };
  });

  const usageMap = new Map<number, { id: number; name: string; domains: string[] }[]>();
  for (const u of usageRows) {
    if (u.certId == null) continue;
    const hosts = usageMap.get(u.certId) ?? [];
    hosts.push({
      id: u.hostId,
      name: u.hostName,
      domains: JSON.parse(u.hostDomains) as string[],
    });
    usageMap.set(u.certId, hosts);
  }

  const importedCerts: ImportedCertView[] = [];
  const managedCerts: ManagedCertView[] = [];

  for (const cert of certRows) {
    const domainNames = JSON.parse(cert.domainNames) as string[];
    if (cert.type === 'imported') {
      const pemInfo = cert.certificatePem ? parsePemInfo(cert.certificatePem) : null;
      importedCerts.push({
        id: cert.id,
        name: cert.name,
        domains: pemInfo?.sanDomains.length ? pemInfo.sanDomains : domainNames,
        validTo: pemInfo?.validTo ?? null,
        validFrom: pemInfo?.validFrom ?? null,
        issuer: pemInfo?.issuer ?? null,
        expiryStatus: pemInfo?.validTo ? getExpiryStatus(pemInfo.validTo) : null,
        usedBy: usageMap.get(cert.id) ?? [],
      });
    } else {
      managedCerts.push({ id: cert.id, name: cert.name, domain_names: domainNames });
    }
  }

  return (
    <CertificatesClient
      acmeHosts={acmeHosts}
      importedCerts={importedCerts}
      managedCerts={managedCerts}
    />
  );
}
