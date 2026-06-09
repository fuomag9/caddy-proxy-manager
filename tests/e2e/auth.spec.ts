import { test, expect } from '@playwright/test';

// Auth tests run WITHOUT pre-authenticated state
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('unauthenticated access to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated access to /proxy-hosts redirects to /login', async ({ page }) => {
    await page.goto('/proxy-hosts');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/login page renders the login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: /username/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('/login with wrong password shows an error message', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
    await page.getByRole('textbox', { name: /password/i }).fill('WrongPassword!');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Should show an error and stay on login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('text=/invalid|error|incorrect/i')).toBeVisible({ timeout: 5000 });
  });

  test('/login with correct credentials lands on dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
    await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
    await page.getByRole('button', { name: /sign in/i }).click();
    // Should redirect away from login
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('logout redirects to /login on the correct host (not 0.0.0.0)', async ({ page }) => {
    // Regression test: logout used request.url as redirect base, which inside
    // Docker resolves to 0.0.0.0 instead of the configured BASE_URL.
    await page.goto('/login');
    await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
    await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 });

    // Click logout
    await page.getByRole('button', { name: /log\s*out|sign\s*out/i }).click();

    // Should land on /login on localhost, not 0.0.0.0
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.hostname).not.toBe('0.0.0.0');
    expect(url.hostname).toBe('localhost');
  });

  test('hyphenated username passes validation (not rejected as invalid)', async ({ page }) => {
    // Regression test for #112: better-auth default username validator rejects hyphens.
    // A non-existent hyphenated user should get 401 (wrong credentials), not 422 (invalid username).
    const res = await page.request.post('http://localhost:3000/api/auth/sign-in/username', {
      data: { username: 'test-hyphen', password: 'SomePassword123!' },
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    });
    // 401 = passed validation, user not found → correct
    // 422 = username rejected by validator → bug
    expect(res.status()).toBe(401);
  });

  test('email self-registration is disabled by default', async ({ page }) => {
    const res = await page.request.post('http://localhost:3000/api/auth/sign-up/email', {
      data: {
        name: 'Self Registration Test',
        email: `self-registration-${Date.now()}@test.invalid`,
        password: 'SelfRegistration2026!',
      },
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    });

    expect(res.status()).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
    });
  });

  test('email self-registration can be enabled with AUTH_ALLOW_SELF_REGISTRATION', async ({ playwright }) => {
    const request = await playwright.request.newContext({
      baseURL: 'http://localhost:3001',
      extraHTTPHeaders: { Origin: 'http://localhost:3001' },
    });
    const email = `self-registration-enabled-${Date.now()}@test.invalid`;

    try {
      const signup = await request.post('/api/auth/sign-up/email', {
        data: {
          name: 'Enabled Self Registration Test',
          email,
          password: 'SelfRegistration2026!',
        },
      });

      expect(signup.status()).toBe(200);
      await expect(signup.json()).resolves.toMatchObject({
        user: {
          email,
          role: 'user',
          status: 'active',
        },
      });

      const session = await request.get('/api/auth/get-session');
      expect(session.status()).toBe(200);
      await expect(session.json()).resolves.toMatchObject({
        user: { email },
      });
    } finally {
      await request.dispose();
    }
  });
});
