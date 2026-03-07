import { test, expect } from '@playwright/test';

test.describe('Access Lists', () => {
  test('page loads without redirecting to login', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('page has an Add button', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page.getByRole('button', { name: /add/i })).toBeVisible();
  });

  test('create access list — appears in the list', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /add/i }).click();

    // Fill in the name
    const nameInput = page.getByLabel(/name/i).first();
    await nameInput.fill('E2E Test List');

    // Save
    await page.getByRole('button', { name: /save|create|add/i }).last().click();

    // Should appear in the list
    await expect(page.getByText('E2E Test List')).toBeVisible({ timeout: 10000 });
  });

  test('delete access list removes it', async ({ page }) => {
    await page.goto('/access-lists');

    // Create one to delete
    await page.getByRole('button', { name: /add/i }).click();
    const nameInput = page.getByLabel(/name/i).first();
    await nameInput.fill('Delete This List');
    await page.getByRole('button', { name: /save|create|add/i }).last().click();
    await expect(page.getByText('Delete This List')).toBeVisible({ timeout: 10000 });

    // Delete it
    const row = page.locator('tr', { hasText: 'Delete This List' });
    await row.getByRole('button', { name: /delete/i }).click();

    const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.getByText('Delete This List')).not.toBeVisible({ timeout: 10000 });
  });
});
