import { test, expect } from '@playwright/test';
import { createSelfSignedServerCertificate, parsePkcs12Identity, type Pkcs12Identity } from '../../helpers/certs';
import { httpsGet, httpsGetOutcome, type ClientTlsIdentity, waitForHttpsRoute } from '../../helpers/https';
import {
  createProxyHost,
  generateCaCertificate,
  importCertificate,
  issueClientCertificate,
  revokeIssuedClientCertificate,
} from '../../helpers/proxy-api';

const PREFIX = `func-mtls-${Date.now()}`;
const SERVER_CERT_NAME = `${PREFIX}-server-cert`;
const CA_A_NAME = `${PREFIX}-ca-a`;
const CA_B_NAME = `${PREFIX}-ca-b`;
const CA_C_NAME = `${PREFIX}-ca-c`;
const CLIENT_A_CN = `${PREFIX}-client-a`;
const CLIENT_B_CN = `${PREFIX}-client-b`;
const REVOKED_CLIENT_CN = `${PREFIX}-client-revoked`;
const LONE_CLIENT_CN = `${PREFIX}-client-lone`;
const BUNDLE_PASSWORD = 'TestBundlePassword2026!';
const ECHO_BODY = 'echo-ok';

const ALLOW_DOMAIN = `${PREFIX}-allow.test`;
const MULTI_CA_DOMAIN = `${PREFIX}-multi.test`;
const APP_DOMAIN = `${PREFIX}-app.test`;
const API_DOMAIN = `${PREFIX}-api.test`;
const REVOKED_DOMAIN = `${PREFIX}-revoked.test`;
const ALL_REVOKED_DOMAIN = `${PREFIX}-all-revoked.test`;

let clientA: Pkcs12Identity;
let clientB: Pkcs12Identity;
let revokedClient: Pkcs12Identity;
let loneClient: Pkcs12Identity;

function tlsIdentity(identity: Pkcs12Identity): ClientTlsIdentity {
  return {
    cert: identity.certificatePem,
    key: identity.privateKeyPem,
  };
}

function expectMtlsBlocked(outcome: Awaited<ReturnType<typeof httpsGetOutcome>>): void {
  if (outcome.response) {
    expect(outcome.response.status).not.toBe(200);
    return;
  }
  expect(outcome.error).toBeDefined();
}

test.describe.serial('mTLS HTTPS enforcement', () => {
  test.setTimeout(180_000);

  test('setup: import server certs, generate CAs, issue clients, and create mTLS hosts', async ({ page }) => {
    const serverCert = createSelfSignedServerCertificate(ALLOW_DOMAIN, [
      ALLOW_DOMAIN,
      MULTI_CA_DOMAIN,
      APP_DOMAIN,
      API_DOMAIN,
      REVOKED_DOMAIN,
      ALL_REVOKED_DOMAIN,
    ]);

    await importCertificate(page, {
      name: SERVER_CERT_NAME,
      domains: [
        ALLOW_DOMAIN,
        MULTI_CA_DOMAIN,
        APP_DOMAIN,
        API_DOMAIN,
        REVOKED_DOMAIN,
        ALL_REVOKED_DOMAIN,
      ],
      certificatePem: serverCert.certificatePem,
      privateKeyPem: serverCert.privateKeyPem,
    });

    await generateCaCertificate(page, { name: CA_A_NAME, commonName: `${CA_A_NAME} Root` });
    await generateCaCertificate(page, { name: CA_B_NAME, commonName: `${CA_B_NAME} Root` });
    await generateCaCertificate(page, { name: CA_C_NAME, commonName: `${CA_C_NAME} Root` });

    clientA = parsePkcs12Identity(
      await issueClientCertificate(page, {
        caName: CA_A_NAME,
        commonName: CLIENT_A_CN,
        exportPassword: BUNDLE_PASSWORD,
      }),
      BUNDLE_PASSWORD
    );

    clientB = parsePkcs12Identity(
      await issueClientCertificate(page, {
        caName: CA_B_NAME,
        commonName: CLIENT_B_CN,
        exportPassword: BUNDLE_PASSWORD,
      }),
      BUNDLE_PASSWORD
    );

    revokedClient = parsePkcs12Identity(
      await issueClientCertificate(page, {
        caName: CA_A_NAME,
        commonName: REVOKED_CLIENT_CN,
        exportPassword: BUNDLE_PASSWORD,
      }),
      BUNDLE_PASSWORD
    );

    loneClient = parsePkcs12Identity(
      await issueClientCertificate(page, {
        caName: CA_C_NAME,
        commonName: LONE_CLIENT_CN,
        exportPassword: BUNDLE_PASSWORD,
      }),
      BUNDLE_PASSWORD
    );

    await createProxyHost(page, {
      name: `${PREFIX} Allow Host`,
      domain: ALLOW_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_A_NAME],
    });

    await createProxyHost(page, {
      name: `${PREFIX} Multi-CA Host`,
      domain: MULTI_CA_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_A_NAME, CA_B_NAME],
    });

    await createProxyHost(page, {
      name: `${PREFIX} App Host`,
      domain: APP_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_A_NAME],
    });

    await createProxyHost(page, {
      name: `${PREFIX} API Host`,
      domain: API_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_B_NAME],
    });

    await createProxyHost(page, {
      name: `${PREFIX} Revoked Host`,
      domain: REVOKED_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_A_NAME],
    });

    await createProxyHost(page, {
      name: `${PREFIX} All Revoked Host`,
      domain: ALL_REVOKED_DOMAIN,
      upstream: 'echo-server:8080',
      certificateName: SERVER_CERT_NAME,
      mtlsCaNames: [CA_C_NAME],
    });

    await waitForHttpsRoute(ALLOW_DOMAIN, tlsIdentity(clientA));
    await waitForHttpsRoute(MULTI_CA_DOMAIN, tlsIdentity(clientB));
    await waitForHttpsRoute(APP_DOMAIN, tlsIdentity(clientA));
    await waitForHttpsRoute(API_DOMAIN, tlsIdentity(clientB));
    await waitForHttpsRoute(REVOKED_DOMAIN, tlsIdentity(revokedClient));
    await waitForHttpsRoute(ALL_REVOKED_DOMAIN, tlsIdentity(loneClient));
  });

  test('blocks HTTPS requests when no client certificate is presented', async () => {
    expectMtlsBlocked(await httpsGetOutcome(ALLOW_DOMAIN));
  });

  test('allows HTTPS requests with a client certificate signed by the configured CA', async () => {
    const response = await httpsGet(ALLOW_DOMAIN, '/', tlsIdentity(clientA));
    expect(response.status).toBe(200);
    expect(response.body).toContain(ECHO_BODY);
  });

  test('blocks client certificates signed by the wrong CA', async () => {
    expectMtlsBlocked(await httpsGetOutcome(ALLOW_DOMAIN, '/', tlsIdentity(clientB)));
  });

  test('accepts client certificates from either trusted CA on a multi-CA host', async () => {
    const responseFromA = await httpsGet(MULTI_CA_DOMAIN, '/', tlsIdentity(clientA));
    const responseFromB = await httpsGet(MULTI_CA_DOMAIN, '/', tlsIdentity(clientB));

    expect(responseFromA.status).toBe(200);
    expect(responseFromA.body).toContain(ECHO_BODY);
    expect(responseFromB.status).toBe(200);
    expect(responseFromB.body).toContain(ECHO_BODY);
  });

  test('isolates per-host CA trust even when hosts share the same imported server certificate', async () => {
    const appResponse = await httpsGet(APP_DOMAIN, '/', tlsIdentity(clientA));
    const apiResponse = await httpsGet(API_DOMAIN, '/', tlsIdentity(clientB));

    expect(appResponse.status).toBe(200);
    expect(apiResponse.status).toBe(200);
    expectMtlsBlocked(await httpsGetOutcome(APP_DOMAIN, '/', tlsIdentity(clientB)));
    expectMtlsBlocked(await httpsGetOutcome(API_DOMAIN, '/', tlsIdentity(clientA)));
  });

  test('revokes a tracked client certificate and blocks it while leaving other active certs usable', async ({ page }) => {
    const beforeRevocation = await httpsGet(REVOKED_DOMAIN, '/', tlsIdentity(revokedClient));
    expect(beforeRevocation.status).toBe(200);

    await revokeIssuedClientCertificate(page, CA_A_NAME, REVOKED_CLIENT_CN);
    await waitForHttpsRoute(ALLOW_DOMAIN, tlsIdentity(clientA));

    expectMtlsBlocked(await httpsGetOutcome(REVOKED_DOMAIN, '/', tlsIdentity(revokedClient)));

    const stillActive = await httpsGet(REVOKED_DOMAIN, '/', tlsIdentity(clientA));
    expect(stillActive.status).toBe(200);
    expect(stillActive.body).toContain(ECHO_BODY);
  });

  test('fails closed when the only issued client certificate for a CA is revoked', async ({ page }) => {
    const beforeRevocation = await httpsGet(ALL_REVOKED_DOMAIN, '/', tlsIdentity(loneClient));
    expect(beforeRevocation.status).toBe(200);

    await revokeIssuedClientCertificate(page, CA_C_NAME, LONE_CLIENT_CN);
    await waitForHttpsRoute(ALLOW_DOMAIN, tlsIdentity(clientA));

    expectMtlsBlocked(await httpsGetOutcome(ALL_REVOKED_DOMAIN));
    expectMtlsBlocked(await httpsGetOutcome(ALL_REVOKED_DOMAIN, '/', tlsIdentity(loneClient)));
  });
});
