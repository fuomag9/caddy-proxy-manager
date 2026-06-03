import { test, expect } from '@playwright/test';
import { X509Certificate } from 'node:crypto';
import forge from 'node-forge';

const API_CA = 'http://localhost:3000/api/v1/ca-certificates';
const API_CLIENT_CERTS = 'http://localhost:3000/api/v1/client-certificates';
const API_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';

/** Self-signed CA with a real RSA keypair, so Caddy accepts the trust pool. */
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
  return {
    cert,
    keys,
    pem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** Client certificate signed by the given CA. */
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
    serialNumber: cert.serialNumber.toUpperCase(),
    fingerprintSha256: x509.fingerprint256,
    validFrom: new Date(x509.validFrom).toISOString(),
    validTo: new Date(x509.validTo).toISOString(),
  };
}

/**
 * Regression: a CA must not be deletable while a proxy host trusts one of its
 * issued client certificates. The original guard in deleteCaCertificate only
 * checked the deprecated `mtls.ca_certificate_ids` field, so a CA referenced
 * via the current `trusted_client_cert_ids` model could be deleted out from
 * under a live mTLS host (silently breaking it). This e2e exercises the real
 * DELETE /api/v1/ca-certificates/:id path end-to-end.
 */
test.describe('mTLS — CA delete guard (in-use protection)', () => {
  // RSA keygen via node-forge is CPU-heavy; give the test room.
  test.setTimeout(60_000);

  test('cannot delete a CA whose issued cert is trusted by a host', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const origin = new URL(page.url()).origin;

    const ca = makeCa('E2E Guard CA');
    const client = makeClientCert(ca, 'e2e-guard-device');

    // 1. Create the CA + issued client cert via the REST API.
    const caResp = await page.request.post(API_CA, {
      headers: { Origin: origin },
      data: { name: 'E2E Guard CA', certificatePem: ca.pem, privateKeyPem: ca.keyPem },
    });
    expect(caResp.ok()).toBeTruthy();
    const caRow = await caResp.json() as { id: number };

    const certResp = await page.request.post(API_CLIENT_CERTS, {
      headers: { Origin: origin },
      data: {
        caCertificateId: caRow.id,
        commonName: 'e2e-guard-device',
        serialNumber: client.serialNumber,
        fingerprintSha256: client.fingerprintSha256,
        certificatePem: client.pem,
        validFrom: client.validFrom,
        validTo: client.validTo,
      },
    });
    expect(certResp.ok()).toBeTruthy();
    const certRow = await certResp.json() as { id: number };

    // 2. Create a host whose mTLS config trusts that cert (current model).
    const hostResp = await page.request.post(API_HOSTS, {
      headers: { Origin: origin },
      data: {
        name: 'E2E Guard Host',
        domains: ['e2e-guard-host.local'],
        upstreams: ['localhost:9000'],
        mtls: { enabled: true, trusted_client_cert_ids: [certRow.id] },
      },
    });
    expect(hostResp.ok()).toBeTruthy();
    const hostRow = await hostResp.json() as { id: number; mtls: { trusted_client_cert_ids?: number[] } | null };
    expect(hostRow.mtls?.trusted_client_cert_ids).toContain(certRow.id);

    let hostDeleted = false;
    try {
      // 3. Deleting the CA must be blocked, naming the offending host.
      const blocked = await page.request.delete(`${API_CA}/${caRow.id}`, { headers: { Origin: origin } });
      expect(blocked.ok()).toBeFalsy();
      const blockedBody = await blocked.json() as { error?: string };
      expect(blockedBody.error ?? '').toMatch(/in use by proxy host/i);
      expect(blockedBody.error ?? '').toContain('E2E Guard Host');

      // 4. The CA and its issued cert must still exist (guard ran before cascade).
      expect((await page.request.get(`${API_CA}/${caRow.id}`)).status()).toBe(200);
      expect((await page.request.get(`${API_CLIENT_CERTS}/${certRow.id}`)).status()).toBe(200);

      // 5. Remove the reference, then deletion succeeds (and cascades the cert).
      const delHost = await page.request.delete(`${API_HOSTS}/${hostRow.id}`, { headers: { Origin: origin } });
      expect(delHost.ok()).toBeTruthy();
      hostDeleted = true;

      const allowed = await page.request.delete(`${API_CA}/${caRow.id}`, { headers: { Origin: origin } });
      expect(allowed.ok()).toBeTruthy();
      expect((await page.request.get(`${API_CLIENT_CERTS}/${certRow.id}`)).status()).toBe(404);
    } finally {
      if (!hostDeleted) {
        await page.request.delete(`${API_HOSTS}/${hostRow.id}`, { headers: { Origin: origin } });
      }
      // Best-effort CA cleanup in case an assertion above failed before delete.
      await page.request.delete(`${API_CA}/${caRow.id}`, { headers: { Origin: origin } });
    }
  });
});
