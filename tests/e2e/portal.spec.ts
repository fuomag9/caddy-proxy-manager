/**
 * E2E tests: Forward Auth Portal login page (/portal).
 *
 * Verifies the portal login flow — error states, form rendering, credential submit.
 * Portal tests run WITHOUT pre-authenticated state since this is a login page.
 */
import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Portal login page', () => {
  test('shows error when no redirect URI is provided', async ({ page }) => {
    await page.goto('/portal');
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByText('No redirect destination specified.')).toBeVisible();
  });

  test('shows login form when redirect URI is provided', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();

    // Credential form fields
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');

    await page.getByLabel('Username').fill('wronguser');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should show an error message
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 10_000 });
  });

  test('username and password fields are required', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');

    // Fields have required attribute — clicking sign in with empty fields should not submit
    const username = page.getByLabel('Username');
    const password = page.getByLabel('Password');

    await expect(username).toHaveAttribute('required', '');
    await expect(password).toHaveAttribute('required', '');
  });
});
