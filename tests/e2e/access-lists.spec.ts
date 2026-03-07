import { test, expect } from '@playwright/test';

test.describe('Access Lists', () => {
  test('page loads without redirecting to login', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('page has a Create Access List button', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page.getByRole('button', { name: /create access list/i })).toBeVisible();
  });

  test('create access list — appears in the list', async ({ page }) => {
    await page.goto('/access-lists');

    // The form is inline on the page (no dialog) — fill Name directly
    await page.getByLabel('Name').fill('E2E Test List');
    await page.getByRole('button', { name: /create access list/i }).click();

    // The created list card appears with a "Delete list" button
    await expect(page.getByRole('button', { name: /delete list/i })).toBeVisible({ timeout: 10000 });
  });

  test('delete access list removes it', async ({ page }) => {
    await page.goto('/access-lists');

    // Create one to delete via the inline form
    await page.getByLabel('Name').fill('Delete This List');
    await page.getByRole('button', { name: /create access list/i }).click();

    // The card appears with a "Delete list" button
    await expect(page.getByRole('button', { name: /delete list/i })).toBeVisible({ timeout: 10000 });

    // Delete it — no confirmation dialog, deletes immediately
    await page.getByRole('button', { name: /delete list/i }).click();

    await expect(page.getByRole('button', { name: /delete list/i })).not.toBeVisible({ timeout: 10000 });
  });
});
