import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

export type AcmeCertInfo = {
  validTo: string;
  validFrom: string;
  issuer: string;
  domains: string[];
};

/**
 * Walks Caddy's certificate storage directory and parses every .crt file.
 * Returns a map from lowercase domain → cert info (most recent cert wins for
 * a given domain if multiple exist).
 *
 * Caddy stores certs under:
 *   <CADDY_CERTS_DIR>/acme-v02.api.letsencrypt.org-directory/<domain>/<domain>.crt
 *   <CADDY_CERTS_DIR>/acme.zerossl.com-v2-DV90/<domain>/<domain>.crt
 *   ...etc
 *
 * The directory is mounted at /caddy-data in the web container, so:
 *   CADDY_CERTS_DIR defaults to /caddy-data/caddy/certificates
 */
const CADDY_CERTS_DIR =
  process.env.CADDY_CERTS_DIR ?? '/caddy-data/caddy/certificates';

function walkCrtFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results; // directory doesn't exist yet (e.g. no certs issued)
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkCrtFiles(full));
      } else if (entry.endsWith('.crt')) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

export function scanAcmeCerts(): Map<string, AcmeCertInfo> {
  const map = new Map<string, AcmeCertInfo>();
  const crtFiles = walkCrtFiles(CADDY_CERTS_DIR);

  for (const file of crtFiles) {
    try {
      const pem = readFileSync(file, 'utf-8');
      const cert = new X509Certificate(pem);

      const sanDomains =
        cert.subjectAltName
          ?.split(',')
          .map(s => s.trim())
          .filter(s => s.startsWith('DNS:'))
          .map(s => s.slice(4).toLowerCase()) ?? [];

      const issuerLine = cert.issuer ?? '';
      const issuer = (
        issuerLine.match(/O=([^\n,]+)/)?.[1] ??
        issuerLine.match(/CN=([^\n,]+)/)?.[1] ??
        issuerLine
      ).trim();

      const info: AcmeCertInfo = {
        validTo: new Date(cert.validTo).toISOString(),
        validFrom: new Date(cert.validFrom).toISOString(),
        issuer,
        domains: sanDomains,
      };

      for (const domain of sanDomains) {
        // Keep the cert with the latest validTo for each domain
        const existing = map.get(domain);
        if (!existing || info.validTo > existing.validTo) {
          map.set(domain, info);
        }
      }
    } catch {
      // skip unreadable / malformed certs
    }
  }

  return map;
}
