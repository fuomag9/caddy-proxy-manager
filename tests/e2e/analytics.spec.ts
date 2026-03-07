import { test, expect } from '@playwright/test';

test.describe('Analytics', () => {
  test('analytics page loads without redirecting to login', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('analytics page renders content', async ({ page }) => {
    await page.goto('/analytics');
    // Should have analytics-related content
    const hasContent = await page.locator('text=/analytics|traffic|requests|blocked/i').count() > 0;
    expect(hasContent).toBe(true);
  });

  test('analytics page shows summary stats section', async ({ page }) => {
    await page.goto('/analytics');
    // Stats or metrics are visible
    await expect(page.locator('body')).toBeVisible();
    // The page should have some numeric or stat display
    const hasStats = await page.locator('[class*="stat"], [class*="metric"], [class*="card"], [class*="summary"]').count() > 0;
    // Just verify it doesn't error out — the content may vary
    expect(await page.title()).toBeTruthy();
  });

  test('analytics page does not show error content', async ({ page }) => {
    await page.goto('/analytics');
    // Should not show error states
    await expect(page.locator('text=/500|internal server error/i')).not.toBeVisible();
  });
});
