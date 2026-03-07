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
    await page.getByRole('button', { name: /create access list/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Name').fill('E2E Test List');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('E2E Test List')).toBeVisible({ timeout: 10000 });
  });

  test('delete access list removes it', async ({ page }) => {
    await page.goto('/access-lists');

    // Create one to delete
    await page.getByRole('button', { name: /create access list/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Name').fill('Delete This List');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Delete This List')).toBeVisible({ timeout: 10000 });

    // Open the list and delete it
    await page.getByText('Delete This List').click();
    await page.getByRole('button', { name: /delete list/i }).click();

    // Confirm
    const confirmBtn = page.getByRole('button', { name: /^delete$/i });
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.getByText('Delete This List')).not.toBeVisible({ timeout: 10000 });
  });
});
