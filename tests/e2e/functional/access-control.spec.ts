/**
 * Functional tests: HTTP Basic Auth via access lists.
 *
 * Creates an access list with a test user, attaches it to a proxy host,
 * and verifies Caddy enforces authentication before forwarding requests
 * to the upstream echo server.
 *
 * Domain: func-auth.test
 */
import { test, expect } from '@playwright/test';
import { createProxyHost, createAccessList } from '../../helpers/proxy-api';
import { httpGet, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-auth.test';
const LIST_NAME = 'Functional Auth List';
const TEST_USER = { username: 'testuser', password: 'S3cur3P@ss!' };
const ECHO_BODY = 'echo-ok';

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

test.describe.serial('Access Control (HTTP Basic Auth)', () => {
  test('setup: create access list and attach to proxy host', async ({ page }) => {
    await createAccessList(page, LIST_NAME, [TEST_USER]);
    await createProxyHost(page, {
      name: 'Functional Auth Test',
      domain: DOMAIN,
      upstream: 'echo-server:8080',
      accessListName: LIST_NAME,
    });
    await waitForRoute(DOMAIN);
  });

  test('request without credentials returns 401', async () => {
    const res = await httpGet(DOMAIN);
    expect(res.status).toBe(401);
  });

  test('request with wrong password returns 401', async () => {
    const res = await httpGet(DOMAIN, '/', {
      Authorization: basicAuth(TEST_USER.username, 'wrongpassword'),
    });
    expect(res.status).toBe(401);
  });

  test('request with wrong username returns 401', async () => {
    const res = await httpGet(DOMAIN, '/', {
      Authorization: basicAuth('wronguser', TEST_USER.password),
    });
    expect(res.status).toBe(401);
  });

  test('request with correct credentials reaches upstream', async () => {
    const res = await httpGet(DOMAIN, '/', {
      Authorization: basicAuth(TEST_USER.username, TEST_USER.password),
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('401 response includes WWW-Authenticate header', async () => {
    const res = await httpGet(DOMAIN);
    expect(res.status).toBe(401);
    const wwwAuth = res.headers['www-authenticate'];
    expect(String(Array.isArray(wwwAuth) ? wwwAuth[0] : wwwAuth)).toMatch(/basic/i);
  });
});
