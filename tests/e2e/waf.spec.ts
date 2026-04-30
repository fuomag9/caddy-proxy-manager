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
    // Save button is on the Settings tab
    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();
  });

  test('WAF page has tabs', async ({ page }) => {
    await page.goto('/waf');
    await expect(page.getByRole('tab', { name: /events/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /suppressed rules/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();
  });

  test('WAF settings toggle persists after save and navigation', async ({ page }) => {
    await page.goto('/waf');
    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();

    const wafSwitch = page.locator('#waf_enabled');
    const owaspCheckbox = page.locator('#waf_load_owasp_crs');

    // Turn WAF on if not already
    const isWafOn = await wafSwitch.getAttribute('data-state');
    if (isWafOn !== 'checked') {
      await wafSwitch.click();
      await expect(wafSwitch).toHaveAttribute('data-state', 'checked');
    }

    // Turn OWASP CRS on if not already
    const isOwaspOn = await owaspCheckbox.getAttribute('data-state');
    if (isOwaspOn !== 'checked') {
      await owaspCheckbox.click();
      await expect(owaspCheckbox).toHaveAttribute('data-state', 'checked');
    }

    await page.getByRole('button', { name: /save waf settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeEnabled({ timeout: 10000 });

    // Navigate away and back to verify persistence
    await page.goto('/hosts');
    await expect(page).not.toHaveURL(/login/);
    await page.goto('/waf');
    await page.getByRole('tab', { name: /settings/i }).click();

    await expect(wafSwitch).toHaveAttribute('data-state', 'checked');
    await expect(owaspCheckbox).toHaveAttribute('data-state', 'checked');
  });
});
