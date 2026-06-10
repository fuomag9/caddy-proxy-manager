import { test, expect } from '@playwright/test';

/**
 * Regression (SECURITY-AUDIT H3): an external OAuth identity provider must NOT
 * be able to set privileged user fields. better-auth's generic-OAuth signup
 * spreads the raw IdP profile claims into the new user record and bypasses the
 * `input:false` flags on `role`/`status`, so an IdP returning `role: "admin"`
 * could self-provision an admin account.
 *
 * The hostile IdP here is `mock-oauth2-server` (Dex can't emit custom claims),
 * configured in tests/mock-oidc/config.json to inject `role: "admin"` into
 * every issued token. We register it as an OAuth provider, complete a real
 * OAuth sign-in (auto-issued — interactiveLogin:false), then assert the created
 * user is role "user", not "admin".
 */

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const ORIGIN = BASE_URL;
const EVIL_EMAIL = 'evil@idp.example';

interface ApiUser { id: number; email: string; role: string }

async function findEvilUser(request: import('@playwright/test').APIRequestContext): Promise<ApiUser | undefined> {
  const resp = await request.get(`${API}/users`);
  expect(resp.ok(), 'list users').toBeTruthy();
  const users = (await resp.json()) as ApiUser[];
  return users.find((u) => u.email === EVIL_EMAIL);
}

test.describe('OAuth — a hostile IdP cannot inject a privileged role', () => {
  test.setTimeout(90_000);

  test('role:"admin" claim from the IdP does not create an admin account', async ({ page, browser }) => {
    // Admin-authenticated context (storageState) used for setup + assertions.
    const admin = page.request;

    // Remove any leftover federated user from a previous run for determinism.
    const stale = await findEvilUser(admin);
    if (stale) await admin.delete(`${API}/users/${stale.id}`, { headers: { Origin: ORIGIN } }).catch(() => {});

    // 1. Register the hostile IdP as an OAuth provider.
    //    issuer/token/userinfo use the in-network alias (also the token `iss`);
    //    the browser-facing authorize URL uses the published localhost port.
    const provName = `Mock Evil IdP ${Date.now()}`;
    const createResp = await admin.post(`${API}/oauth-providers`, {
      headers: { Origin: ORIGIN },
      data: {
        name: provName,
        type: 'oidc',
        clientId: 'cpm',
        clientSecret: 'secret',
        issuer: 'http://mock-oidc:8080/default',
        authorizationUrl: 'http://localhost:5557/default/authorize',
        tokenUrl: 'http://mock-oidc:8080/default/token',
        userinfoUrl: 'http://mock-oidc:8080/default/userinfo',
        scopes: 'openid email profile',
      },
    });
    expect(createResp.ok(), 'create oauth provider').toBeTruthy();
    const providerId = (await createResp.json()).id as number;

    let createdUserId: number | undefined;
    try {
      // 2. Complete an OAuth sign-in in a CLEAN context (no admin session), so
      //    we exercise real federated signup, not the admin session. The empty
      //    storageState is required — browser.newContext() otherwise inherits
      //    the project's admin storageState and /login redirects to "/".
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const oauthPage = await ctx.newPage();
      try {
        await oauthPage.goto(`${BASE_URL}/login`);
        const button = oauthPage.getByRole('button', {
          name: new RegExp(`continue with ${provName}`, 'i'),
        });
        await expect(button).toBeVisible({ timeout: 15_000 });
        await button.click();

        // mock-oauth2-server (interactiveLogin:false) auto-issues a code and the
        // app completes the callback, landing back on the dashboard ("/").
        await oauthPage.waitForURL(
          (url) => {
            try {
              const u = new URL(url);
              return (
                u.origin === BASE_URL &&
                !u.pathname.startsWith('/api/auth') &&
                !u.pathname.startsWith('/login')
              );
            } catch {
              return false;
            }
          },
          { timeout: 30_000 }
        );
        expect(oauthPage.url(), 'OAuth sign-in should not error').not.toContain('error');
      } finally {
        await ctx.close();
      }

      // 3. The federated user must exist and must NOT be an admin.
      const evil = await findEvilUser(admin);
      expect(evil, 'federated user should have been created').toBeDefined();
      createdUserId = evil!.id;
      expect(evil!.role, 'IdP-supplied role:"admin" must be ignored').toBe('user');
    } finally {
      if (createdUserId) {
        await admin.delete(`${API}/users/${createdUserId}`, { headers: { Origin: ORIGIN } }).catch(() => {});
      }
      await admin.delete(`${API}/oauth-providers/${providerId}`, { headers: { Origin: ORIGIN } }).catch(() => {});
    }
  });
});
