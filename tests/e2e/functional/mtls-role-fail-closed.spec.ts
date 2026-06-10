import { test, expect } from '@playwright/test';
import { X509Certificate } from 'node:crypto';
import forge from 'node-forge';
import { createSelfSignedServerCertificate } from '../../helpers/certs';
import { httpsGet, httpsGetOutcome, waitForHttpsRoute, type ClientTlsIdentity } from '../../helpers/https';

/**
 * Regression (SECURITY-AUDIT H2): role-based mTLS must FAIL CLOSED when the
 * trusted role no longer resolves to any active client certificate — e.g. its
 * only issued cert is revoked. The bug dropped such a host out of the mTLS trust
 * map entirely, so Caddy served a plain TLS policy with no client_authentication
 * and the backend became reachable by anyone with NO client certificate.
 *
 * Drives the real REST API (roles + role-trusting host) and verifies behaviour
 * over real TLS against the test Caddy + echo-server stack.
 */

const API_CA = 'http://localhost:3000/api/v1/ca-certificates';
const API_CLIENT_CERTS = 'http://localhost:3000/api/v1/client-certificates';
const API_ROLES = 'http://localhost:3000/api/v1/mtls-roles';
const API_CERTS = 'http://localhost:3000/api/v1/certificates';
const API_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';
const ECHO_BODY = 'echo-ok';

function makeCa(commonName: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(cert.validity.notBefore);
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { cert, keys, pem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
}

/** Client cert signed by the CA. Returns the key too, so it can be used as a TLS identity. */
function makeClientCert(ca: ReturnType<typeof makeCa>, commonName: string) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(cert.validity.notBefore);
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);
  cert.setSubject([{ name: 'commonName', value: commonName }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', clientAuth: true },
  ]);
  cert.sign(ca.keys.privateKey, forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  const x509 = new X509Certificate(pem);
  return {
    pem,
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    serialNumber: cert.serialNumber.toUpperCase(),
    fingerprintSha256: x509.fingerprint256,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
  };
}

function expectMtlsBlocked(outcome: Awaited<ReturnType<typeof httpsGetOutcome>>): void {
  if (outcome.response) {
    expect(outcome.response.status).not.toBe(200);
    return;
  }
  expect(outcome.error).toBeDefined();
}

test.describe('mTLS — role-based trust fails closed on revocation', () => {
  test.setTimeout(120_000); // RSA keygen + two Caddy config reloads

  test('revoking the trusted role\'s only cert denies all clients (no fail-open)', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const origin = new URL(page.url()).origin;
    const post = (url: string, data: unknown) => page.request.post(url, { headers: { Origin: origin }, data });
    const del = (url: string) => page.request.delete(url, { headers: { Origin: origin } });

    const prefix = `e2e-mtls-role-${Date.now()}`;
    const domain = `${prefix}.test`;
    const ca = makeCa(`${prefix} CA`);
    const client = makeClientCert(ca, `${prefix}-client`);
    const server = createSelfSignedServerCertificate(domain, [domain]);
    const clientIdentity: ClientTlsIdentity = { cert: client.pem, key: client.keyPem };

    const ids = { caId: 0, certId: 0, roleId: 0, serverCertId: 0, hostId: 0 };

    try {
      const caResp = await post(API_CA, { name: `${prefix} CA`, certificatePem: ca.pem, privateKeyPem: ca.keyPem });
      expect(caResp.ok(), 'create CA').toBeTruthy();
      ids.caId = (await caResp.json()).id;

      const certResp = await post(API_CLIENT_CERTS, {
        caCertificateId: ids.caId,
        commonName: `${prefix}-client`,
        serialNumber: client.serialNumber,
        fingerprintSha256: client.fingerprintSha256,
        certificatePem: client.pem,
        validFrom: client.validFrom,
        validTo: client.validTo,
      });
      expect(certResp.ok(), 'register client cert').toBeTruthy();
      ids.certId = (await certResp.json()).id;

      const roleResp = await post(API_ROLES, { name: `${prefix}-role` });
      expect(roleResp.ok(), 'create role').toBeTruthy();
      ids.roleId = (await roleResp.json()).id;

      const assignResp = await post(`${API_ROLES}/${ids.roleId}/certificates`, { certificateId: ids.certId });
      expect(assignResp.ok(), 'assign cert to role').toBeTruthy();

      const serverResp = await post(API_CERTS, {
        name: `${prefix}-server`,
        type: 'imported',
        domainNames: [domain],
        certificatePem: server.certificatePem,
        privateKeyPem: server.privateKeyPem,
      });
      expect(serverResp.ok(), 'import server cert').toBeTruthy();
      ids.serverCertId = (await serverResp.json()).id;

      // Host trusts the ROLE (not a specific cert / CA) — the H2 code path.
      const hostResp = await post(API_HOSTS, {
        name: `${prefix} Host`,
        domains: [domain],
        upstreams: ['echo-server:8080'],
        certificateId: ids.serverCertId,
        mtls: { enabled: true, trusted_role_ids: [ids.roleId] },
      });
      expect(hostResp.ok(), 'create role-trusting host').toBeTruthy();
      ids.hostId = (await hostResp.json()).id;

      // ── Baseline: role has one active cert → mTLS enforced normally. ──
      await waitForHttpsRoute(domain, clientIdentity);
      const withCert = await httpsGet(domain, '/', clientIdentity);
      expect(withCert.status, 'trusted client cert is accepted').toBe(200);
      expect(withCert.body).toContain(ECHO_BODY);
      expectMtlsBlocked(await httpsGetOutcome(domain)); // no cert → blocked

      // ── Revoke the only cert in the trusted role (triggers config reload). ──
      const revokeResp = await del(`${API_CLIENT_CERTS}/${ids.certId}`);
      expect(revokeResp.ok(), 'revoke client cert').toBeTruthy();

      // Wait for the new config to go live: the now-revoked cert must stop being
      // accepted. (With the H2 bug the host would fall open to plain TLS and the
      // revoked cert — and no cert — would keep returning 200, so this poll would
      // never flip and the test fails.)
      await expect
        .poll(async () => (await httpsGetOutcome(domain, '/', clientIdentity)).response?.status, {
          timeout: 45_000,
          intervals: [1_000, 2_000, 3_000],
        })
        .not.toBe(200);

      // ── The H2 assertion: with no resolvable trust, the host must DENY all. ──
      expectMtlsBlocked(await httpsGetOutcome(domain)); // no client cert → still blocked (NOT served open)
      expectMtlsBlocked(await httpsGetOutcome(domain, '/', clientIdentity)); // revoked cert → blocked
    } finally {
      if (ids.hostId) await del(`${API_HOSTS}/${ids.hostId}`).catch(() => {});
      if (ids.roleId) await del(`${API_ROLES}/${ids.roleId}`).catch(() => {});
      if (ids.serverCertId) await del(`${API_CERTS}/${ids.serverCertId}`).catch(() => {});
      if (ids.caId) await del(`${API_CA}/${ids.caId}`).catch(() => {}); // cascades the revoked client cert
    }
  });

  test('API rejects enabling mTLS with no trusted certs, roles, or CAs', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const origin = new URL(page.url()).origin;

    const resp = await page.request.post(API_HOSTS, {
      headers: { Origin: origin },
      data: {
        name: `e2e-mtls-no-trust-${Date.now()}`,
        domains: [`e2e-mtls-no-trust-${Date.now()}.test`],
        upstreams: ['echo-server:8080'],
        mtls: { enabled: true },
      },
    });

    expect(resp.ok(), 'enabling mTLS with no trust material must be rejected').toBeFalsy();
    const body = await resp.json().catch(() => ({}));
    expect(JSON.stringify(body)).toMatch(/no trusted client certificates, roles, or CA/i);
  });
});
