/**
 * Functional test: custom ACME directory + internal CA trust (issue #192).
 *
 * Proves the full end-to-end path that unit/integration tests can't reach:
 * a real certificate is issued by an internal ACME server (Step-CA) instead of
 * Let's Encrypt, and Caddy trusts that CA's HTTPS endpoint via the CA-root PEM
 * written to the shared `acme-ca` volume.
 *
 * Flow:
 *   1. Read Step-CA's auto-generated root cert out of its container.
 *   2. Point CPM's global ACME settings at Step-CA's directory + paste the root.
 *   3. Create an auto-managed proxy host for `acme-e2e.test` (aliased to Caddy,
 *      so Step-CA can validate the HTTP-01 / TLS-ALPN-01 challenge).
 *   4. Assert the leaf cert Caddy serves for that domain was issued by Step-CA.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import tls from 'node:tls';

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const DOMAIN = 'acme-e2e.test';
const STEP_CA_NAME = 'CPM E2E Step-CA';
const STEP_CA_DIRECTORY = 'https://step-ca:9000/acme/acme/directory';
const STEP_CA_CONTAINER = 'caddy-proxy-manager-step-ca';

/** Read Step-CA's root cert from its container, retrying until init completes. */
function readStepCaRoot(timeoutMs = 60_000): string {
  const deadline = Date.now() + timeoutMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const out = execFileSync(
        'docker',
        ['exec', STEP_CA_CONTAINER, 'cat', '/home/step/certs/root_ca.crt'],
        { encoding: 'utf-8' },
      );
      if (out.includes('BEGIN CERTIFICATE')) return out.trim();
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    execFileSync('sleep', ['2']);
  }
  throw new Error(`Step-CA root cert not available within ${timeoutMs}ms: ${lastErr}`);
}

/** Open a TLS connection to Caddy with the given SNI and return the leaf cert issuer. */
function getLeafIssuer(servername: string): Promise<tls.PeerCertificate> {
  return new Promise((resolve, reject) => {
    // rejectUnauthorized:false is deliberate and safe here — this test only
    // INSPECTS the served leaf to confirm Step-CA issued it; no data is sent and
    // the client root isn't installed, so chain validation would just get in the way.
    const socket = tls.connect(
      { host: '127.0.0.1', port: 443, servername, rejectUnauthorized: false, timeout: 5_000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert);
      },
    );
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('TLS timeout')); });
  });
}

/** Poll until Caddy serves a leaf for `servername` issued by Step-CA. */
async function waitForStepCaCert(servername: string, timeoutMs = 90_000): Promise<tls.PeerCertificate> {
  const deadline = Date.now() + timeoutMs;
  let lastIssuer = '';
  while (Date.now() < deadline) {
    try {
      const cert = await getLeafIssuer(servername);
      const issuer = cert?.issuer ? JSON.stringify(cert.issuer) : '';
      lastIssuer = issuer;
      if (issuer.includes(STEP_CA_NAME)) return cert;
    } catch {
      // handshake not ready yet
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`No Step-CA-issued cert for "${servername}" within ${timeoutMs}ms (last issuer: ${lastIssuer})`);
}

test.describe.serial('Custom ACME directory — real issuance via Step-CA', () => {
  let hostId: number | undefined;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();

    const root = readStepCaRoot();
    const acmeRes = await page.request.put(`${API}/settings/acme`, {
      data: { caUrl: STEP_CA_DIRECTORY, caRootPem: root },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(acmeRes.status()).toBe(200);

    const hostRes = await page.request.post(`${API}/proxy-hosts`, {
      data: { name: 'ACME custom CA', domains: [DOMAIN], upstreams: ['whoami-server:80'], sslForced: true },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(hostRes.status()).toBe(201);
    hostId = (await hostRes.json()).id as number;

    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    if (hostId !== undefined) {
      await page.request.delete(`${API}/proxy-hosts/${hostId}`, { headers: { Origin: BASE_URL } });
    }
    // Revert the global ACME directory so other specs fall back to the default.
    await page.request.put(`${API}/settings/acme`, {
      data: { caUrl: '', caRootPem: '' },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    await page.close();
  });

  test('Caddy obtains the cert from Step-CA, not Let\'s Encrypt', async () => {
    const cert = await waitForStepCaCert(DOMAIN);
    const issuer = JSON.stringify(cert.issuer ?? {});
    expect(issuer).toContain(STEP_CA_NAME);
    // Sanity: it must NOT be Caddy's internal self-signed authority.
    expect(issuer).not.toContain('Caddy Local Authority');
    // The leaf must actually cover the requested domain.
    expect(JSON.stringify(cert.subjectaltname ?? '')).toContain(DOMAIN);
  });
});
