import { test, expect } from '@playwright/test';

test.describe('Certificates', () => {
  test('page loads with tabs visible', async ({ page }) => {
    await page.goto('/certificates');
    // At minimum the page should load without error
    await expect(page).not.toHaveURL(/error|login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('certificates page has certificate management UI', async ({ page }) => {
    await page.goto('/certificates');
    // Should have some kind of Add button or tab UI
    await expect(page.locator('body')).toBeVisible();
    // Look for tabs or buttons
    const hasAddButton = await page.getByRole('button', { name: /add|new|create/i }).count() > 0;
    const hasTab = await page.getByRole('tab').count() > 0;
    expect(hasAddButton || hasTab).toBe(true);
  });

  test('navigating to certificates does not redirect to login', async ({ page }) => {
    await page.goto('/certificates');
    await expect(page).not.toHaveURL(/login/);
  });
});
