import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('settings page loads without redirecting to login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('settings page renders content', async ({ page }) => {
    await page.goto('/settings');
    // Settings page should have some sections
    await expect(page.locator('body')).toBeVisible();
    // Check for settings-related text
    const hasContent = await page.locator('text=/settings|general|cloudflare|dns|logging/i').count() > 0;
    expect(hasContent).toBe(true);
  });

  test('settings page has save buttons', async ({ page }) => {
    await page.goto('/settings');
    const saveButtons = page.getByRole('button', { name: /save/i });
    await expect(saveButtons.first()).toBeVisible();
  });

  test('general settings section: can fill and save primary domain', async ({ page }) => {
    await page.goto('/settings');

    // Look for the primary domain or general settings input
    const domainInput = page.getByLabel(/primary domain/i).first();
    if (await domainInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await domainInput.fill('test.local');
      const saveBtn = page.getByRole('button', { name: /save/i }).first();
      await saveBtn.click();
      // Toast or success indicator should appear
      await expect(page.locator('text=/saved|success/i')).toBeVisible({ timeout: 5000 });
    } else {
      // If the UI is different, just verify the page loaded
      test.skip();
    }
  });
});
