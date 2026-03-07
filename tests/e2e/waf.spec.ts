import { test, expect } from '@playwright/test';

test.describe('WAF', () => {
  test('WAF page loads without redirecting to login', async ({ page }) => {
    await page.goto('/waf');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('WAF page has global settings visible', async ({ page }) => {
    await page.goto('/waf');
    const hasWafContent = await page.locator('text=/waf|mode|enabled|owasp/i').count() > 0;
    expect(hasWafContent).toBe(true);
  });

  test('WAF page has Save WAF settings button', async ({ page }) => {
    await page.goto('/waf');
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();
  });

  test('WAF page has tabs', async ({ page }) => {
    await page.goto('/waf');
    await expect(page.getByRole('tab', { name: /events/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /suppressed rules/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();
  });
});
