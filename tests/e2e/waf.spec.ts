import { test, expect } from '@playwright/test';

test.describe('WAF', () => {
  test('WAF page loads without redirecting to login', async ({ page }) => {
    await page.goto('/waf');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('WAF page has global settings visible', async ({ page }) => {
    await page.goto('/waf');
    // Should have some WAF-related content
    await expect(page.locator('body')).toBeVisible();
    // Look for WAF, mode, or enable controls
    const hasWafContent = await page.locator('text=/waf|mode|enabled|owasp/i').count() > 0;
    expect(hasWafContent).toBe(true);
  });

  test('WAF page has save button', async ({ page }) => {
    await page.goto('/waf');
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
  });
});
