import * as tls from 'node:tls';

export type AcmeCertInfo = {
  validTo: string;
  validFrom: string;
  issuer: string;
  domains: string[];
};

/**
 * Connects to the Caddy server via TLS and reads the peer certificate
 * presented for the given SNI hostname. This avoids reading Caddy's
 * certificate storage directory (which uses 0700 permissions from
 * certmagic, making it inaccessible to the web container).
 */
function probeCert(host: string, port: number, servername: string): Promise<AcmeCertInfo | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, 5000);

    const socket = tls.connect(
      { host, port, servername, rejectUnauthorized: false },
      () => {
        clearTimeout(timeout);
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !cert.valid_to) {
          resolve(null);
          return;
        }

        // Extract SAN domains
        const sanDomains =
          (cert.subjectaltname ?? '')
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => s.startsWith('DNS:'))
            .map((s: string) => s.slice(4).toLowerCase());

        // Extract issuer organization or CN
        const issuer =
          cert.issuer?.O ??
          cert.issuer?.CN ??
          (typeof cert.issuer === 'string' ? cert.issuer : '');

        resolve({
          validTo: new Date(cert.valid_to).toISOString(),
          validFrom: new Date(cert.valid_from).toISOString(),
          issuer: String(issuer).trim(),
          domains: sanDomains,
        });
      },
    );

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/**
 * Probes Caddy's TLS listener for each unique domain and returns a map
 * from lowercase domain → cert info. The Caddy host and port are derived
 * from CADDY_API_URL (defaults to caddy:443 for the TLS listener).
 */
export async function scanAcmeCerts(
  domains: string[],
): Promise<Map<string, AcmeCertInfo>> {
  // Caddy's TLS listener — same host as the admin API, port 443
  const apiUrl = process.env.CADDY_API_URL ?? 'http://caddy:2019';
  const caddyHost = new URL(apiUrl).hostname;
  const caddyPort = 443;

  const unique = [...new Set(domains.map((d) => d.toLowerCase()))];
  const map = new Map<string, AcmeCertInfo>();

  // Probe in parallel with a concurrency limit
  const CONCURRENCY = 5;
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const batch = unique.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((domain) => probeCert(caddyHost, caddyPort, domain)),
    );
    for (let j = 0; j < batch.length; j++) {
      const info = results[j];
      if (!info) continue;
      // A single cert may cover multiple domains (SAN); map all of them
      for (const san of info.domains) {
        const existing = map.get(san);
        if (
          !existing ||
          new Date(info.validTo).getTime() > new Date(existing.validTo).getTime()
        ) {
          map.set(san, info);
        }
      }
      // Also map the probed domain itself in case it's not in SAN list
      if (!map.has(batch[j])) {
        map.set(batch[j], info);
      }
    }
  }

  return map;
}
