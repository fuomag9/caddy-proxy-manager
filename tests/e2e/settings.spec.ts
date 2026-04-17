import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('settings page loads without redirecting to login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('settings page renders content', async ({ page }) => {
    await page.goto('/settings');
    const hasContent = await page.locator('text=/settings|general|dns provider|dns|logging/i').count() > 0;
    expect(hasContent).toBe(true);
  });

  test('settings page has named save buttons', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeVisible();
  });

  test('general settings: fill primary domain and save', async ({ page }) => {
    await page.goto('/settings');

    const domainInput = page.getByLabel('Primary domain');
    await domainInput.fill('test.local');

    await page.getByRole('button', { name: /save general settings/i }).click();

    // Wait for the button to re-enable (save completes) or any success indicator
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeEnabled({ timeout: 10000 });
  });

  test('settings page has DNS Provider and DNS sections', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'DNS Providers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /save dns settings/i })).toBeVisible();
  });
});
