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

    // Note initial count (may be non-zero from other tests)
    const initialCount = await page.getByRole('button', { name: /delete list/i }).count();

    // The form is inline on the page (no dialog) — use placeholder to uniquely target create form
    await page.getByPlaceholder('Internal users').fill('E2E Test List');
    await page.getByRole('button', { name: /create access list/i }).click();

    // A new card with a "Delete list" button should appear
    await expect(page.getByRole('button', { name: /delete list/i })).toHaveCount(initialCount + 1, { timeout: 10000 });
  });

  test('delete access list removes it', async ({ page }) => {
    await page.goto('/access-lists');

    // Note initial count
    const initialCount = await page.getByRole('button', { name: /delete list/i }).count();

    // Create via the inline form — use placeholder to uniquely target create form
    await page.getByPlaceholder('Internal users').fill('Delete This List');
    await page.getByRole('button', { name: /create access list/i }).click();

    // Wait for new card
    await expect(page.getByRole('button', { name: /delete list/i })).toHaveCount(initialCount + 1, { timeout: 10000 });

    // Delete the first card — no confirmation dialog, deletes immediately
    await page.getByRole('button', { name: /delete list/i }).first().click();

    // Count should return to initial
    await expect(page.getByRole('button', { name: /delete list/i })).toHaveCount(initialCount, { timeout: 10000 });
  });
});
