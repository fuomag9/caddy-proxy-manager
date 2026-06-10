import { test, expect, type BrowserContext } from '@playwright/test';

/**
 * Active session management (profile "Active sessions"): list sessions, mark the
 * current one, and securely revoke another session — which logs that session out.
 */

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const ADMIN = { username: 'testadmin', password: 'TestPassword2026!' };

interface SessionRow {
  id: number;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Log in via the UI in the given (clean) context, creating a new session. */
async function loginViaUi(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByRole('textbox', { name: /username/i }).fill(ADMIN.username);
  await page.getByRole('textbox', { name: /password/i }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
  await page.close();
}

test.describe('Active session management', () => {
  test.setTimeout(90_000);

  test('lists sessions, marks the current one, and revoking another logs it out', async ({ page, browser }) => {
    // `page` carries the admin storageState (session #1). Create a second,
    // independent session in a CLEAN context. The empty storageState is
    // required — browser.newContext() otherwise inherits the project's admin
    // storageState, so /login would redirect to "/" instead of showing the form.
    const ctx2 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await loginViaUi(ctx2);

    try {
      // From ctx2's own view, its session is the current one — capture its id.
      const list2 = (await (await ctx2.request.get(`${API}/sessions`)).json()) as SessionRow[];
      const session2 = list2.find((s) => s.current);
      expect(session2, 'fresh context should report a current session').toBeTruthy();
      const session2Id = session2!.id;

      // Session #1 sees session #2 in its list, with exactly one "current" (its own, ≠ #2).
      const list1 = (await (await page.request.get(`${API}/sessions`)).json()) as SessionRow[];
      expect(list1.some((s) => s.id === session2Id)).toBeTruthy();
      expect(list1.filter((s) => s.current).length).toBe(1);
      expect(list1.find((s) => s.current)!.id).not.toBe(session2Id);

      // Revoke session #2 from session #1.
      const del = await page.request.delete(`${API}/sessions/${session2Id}`, { headers: { Origin: BASE_URL } });
      expect(del.ok()).toBeTruthy();

      // It's gone from the list…
      const after = (await (await page.request.get(`${API}/sessions`)).json()) as SessionRow[];
      expect(after.some((s) => s.id === session2Id)).toBeFalsy();

      // …and session #2 is now logged out (its authenticated API call is rejected).
      expect((await ctx2.request.get(`${API}/sessions`)).status()).toBe(401);
    } finally {
      await ctx2.close();
    }
  });

  test('cannot revoke a session id that does not belong to the user', async ({ page }) => {
    // A wildly out-of-range id is not the caller's session → 404, never 200.
    const resp = await page.request.delete(`${API}/sessions/2147483000`, { headers: { Origin: BASE_URL } });
    expect(resp.status()).toBe(404);
  });

  test('profile page renders the Active Sessions card with the current device', async ({ page }) => {
    await page.goto(`${BASE_URL}/profile`);
    await expect(page.getByRole('heading', { name: /active sessions/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/this device/i).first()).toBeVisible();
  });
});
