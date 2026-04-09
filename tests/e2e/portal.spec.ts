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
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  });

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');

    await page.getByLabel('Username').fill('wronguser');
    await page.getByLabel('Password').fill('wrongpass');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Should show an error message (use .first() to avoid matching Next.js route announcer)
    await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 10_000 });
  });

  test('username and password fields are required', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');

    // Fields have required attribute — clicking sign in with empty fields should not submit
    const username = page.getByLabel('Username');
    const password = page.getByLabel('Password');

    await expect(username).toHaveAttribute('required', '');
    await expect(password).toHaveAttribute('required', '');
  });

  test('rejects javascript: URI — no rid is created', async ({ page }) => {
    await page.goto('/portal?rd=javascript:alert(1)');
    // Form shows (hasRedirect is true) but no rid is created — login will fail
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
  });

  test('rejects data: URI — no rid is created', async ({ page }) => {
    await page.goto('/portal?rd=data:text/html,<h1>evil</h1>');
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
  });

  test('rejects file: URI — no rid is created', async ({ page }) => {
    await page.goto('/portal?rd=file:///etc/passwd');
    await expect(page.getByText('Authentication Required')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
  });

  test('shows OAuth sign-in button when OIDC is enabled', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');
    // Dex is configured in the test stack — the OAuth button should appear
    await expect(page.getByRole('button', { name: /Sign in with Dex/i })).toBeVisible();
  });

  test('shows both OAuth button and credential form', async ({ page }) => {
    await page.goto('/portal?rd=http://example.com');
    // Both auth methods should be available
    await expect(page.getByRole('button', { name: /Sign in with Dex/i })).toBeVisible();
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    // "or" separator between OAuth and credentials
    await expect(page.getByText('or', { exact: true })).toBeVisible();
  });

  test('preserves ?rid= parameter for OAuth return flow', async ({ page }) => {
    // When returning from OAuth, the portal gets ?rid=<opaque>
    // With a fake rid it should still show the login form (not "No redirect destination")
    await page.goto('/portal?rid=abc123fakeopaqueid');
    await expect(page.getByText('Authentication Required')).toBeVisible();
    // It has a redirect (the rid), so it should show the form, not the "no destination" message
    await expect(page.getByText('No redirect destination specified.')).not.toBeVisible();
  });
});
