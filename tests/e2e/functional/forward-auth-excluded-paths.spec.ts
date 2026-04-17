/**
 * Functional tests: CPM Forward Auth with excluded paths.
 *
 * Creates a proxy host with CPM forward auth enabled and excluded_paths set,
 * then verifies:
 * - Excluded paths bypass auth and reach the upstream directly
 * - Non-excluded paths still require authentication (redirect to portal)
 * - The callback route still works for completing auth on non-excluded paths
 *
 * This validates the fix for GitHub issue #108: the ability to exclude
 * specific paths from forward auth (e.g., /share/*, /rest/* for Navidrome).
 *
 * Domain: func-fwd-auth-excl.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, waitForStatus } from '../../helpers/http';

const DOMAIN = 'func-fwd-auth-excl.test';
const ECHO_BODY = 'echo-ok';
const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;

let proxyHostId: number;

test.describe.serial('Forward Auth Excluded Paths', () => {
  test('setup: create proxy host with forward auth and excluded paths via API', async ({ page }) => {
    const res = await page.request.post(`${API}/proxy-hosts`, {
      data: {
        name: 'Excluded Paths Test',
        domains: [DOMAIN],
        upstreams: ['echo-server:8080'],
        sslForced: false,
        cpmForwardAuth: {
          enabled: true,
          excluded_paths: ['/share/*', '/rest/*'],
        },
      },
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    });
    expect(res.status()).toBe(201);
    const host = await res.json();
    proxyHostId = host.id;

    // Grant testadmin (user ID 1) forward auth access
    const accessRes = await page.request.put(`${API}/proxy-hosts/${proxyHostId}/forward-auth-access`, {
      data: { userIds: [1], groupIds: [] },
      headers: { 'Content-Type': 'application/json', 'Origin': BASE_URL },
    });
    expect(accessRes.status()).toBe(200);

    // Wait for Caddy to pick up the config — non-excluded paths should redirect (302)
    await waitForStatus(DOMAIN, 302, 20_000);
  });

  test('excluded path /share/* bypasses auth and reaches upstream', async () => {
    const res = await httpGet(DOMAIN, '/share/some-track');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('excluded path /rest/* bypasses auth and reaches upstream', async () => {
    const res = await httpGet(DOMAIN, '/rest/ping');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('non-excluded root path requires auth (redirects to portal)', async () => {
    const res = await httpGet(DOMAIN, '/');
    expect(res.status).toBe(302);
    const location = String(res.headers['location']);
    expect(location).toContain('/portal?rd=');
    expect(location).toContain(DOMAIN);
  });

  test('non-excluded arbitrary path requires auth', async () => {
    const res = await httpGet(DOMAIN, '/admin/dashboard');
    expect(res.status).toBe(302);
    expect(String(res.headers['location'])).toContain('/portal');
  });

  test('credential login works for non-excluded paths', async ({ page }) => {
    const context = await page.context().browser()!.newContext({ storageState: { cookies: [], origins: [] } });
    const freshPage = await context.newPage();

    try {
      await freshPage.goto(`${BASE_URL}/portal?rd=http://${DOMAIN}/protected-page`);
      await expect(freshPage.getByLabel('Username')).toBeVisible({ timeout: 10_000 });

      // Intercept the login API response
      let capturedRedirect: string | null = null;
      await freshPage.route('**/api/forward-auth/login', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        capturedRedirect = json.redirectTo ?? null;
        await route.fulfill({ response });
      });

      await freshPage.getByLabel('Username').fill('testadmin');
      await freshPage.getByLabel('Password').fill('TestPassword2026!');
      await freshPage.getByRole('button', { name: 'Sign in', exact: true }).click();

      const deadline = Date.now() + 15_000;
      while (!capturedRedirect && Date.now() < deadline) {
        await freshPage.waitForTimeout(200);
      }

      expect(capturedRedirect).toBeTruthy();
      expect(capturedRedirect).toContain('/.cpm-auth/callback');

      // Complete the callback
      const callbackUrl = new URL(capturedRedirect!);
      const callbackRes = await httpGet(DOMAIN, callbackUrl.pathname + callbackUrl.search);
      expect(callbackRes.status).toBe(302);
      const setCookie = String(callbackRes.headers['set-cookie'] ?? '');
      expect(setCookie).toContain('_cpm_fa=');

      // Verify authenticated access to non-excluded path
      const match = setCookie.match(/_cpm_fa=([^;]+)/);
      expect(match).toBeTruthy();
      const sessionCookie = match![1];
      const upstreamRes = await httpGet(DOMAIN, '/protected-page', {
        Cookie: `_cpm_fa=${sessionCookie}`,
      });
      expect(upstreamRes.status).toBe(200);
      expect(upstreamRes.body).toContain(ECHO_BODY);
    } finally {
      await context.close();
    }
  });

  test('cleanup: delete proxy host', async ({ page }) => {
    if (proxyHostId) {
      const res = await page.request.delete(`${API}/proxy-hosts/${proxyHostId}`, {
        headers: { 'Origin': BASE_URL },
      });
      expect(res.status()).toBe(200);
    }
  });
});
