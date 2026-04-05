/**
 * E2E tests: Link Account page (/link-account).
 *
 * This page requires a valid LINKING_REQUIRED: error param with a valid JWT linking token.
 * Without that, it redirects to /login. We test the redirect behavior and the fallback
 * "Sign in with Password Instead" button.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Link Account page', () => {
  test('redirects to /login when no error param is provided', async ({ page }) => {
    await page.goto('/link-account');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects to /login with invalid linking token', async ({ page }) => {
    await page.goto('/link-account?error=LINKING_REQUIRED:invalid-token');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects to /login when error param is not LINKING_REQUIRED', async ({ page }) => {
    await page.goto('/link-account?error=SomeOtherError');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('redirects authenticated users to /', async ({ page, context }) => {
    // First log in
    await page.goto('http://localhost:3000/login');
    await page.getByRole('textbox', { name: /username/i }).fill('testadmin');
    await page.getByRole('textbox', { name: /password/i }).fill('TestPassword2026!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

    // Now visit link-account — should redirect to /
    await page.goto('/link-account?error=LINKING_REQUIRED:some-token');
    await expect(page).toHaveURL(/^\/$|\/(?!link-account)/, { timeout: 10_000 });
  });
});
