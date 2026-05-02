import { test, expect } from '@playwright/test';

test.describe('WAF', () => {
  test('WAF events period filters support presets, custom range, and reset to all time', async ({ page }) => {
    const customFrom = '2026-05-01T09:00';
    const customTo = '2026-05-02T09:30';
    const expectedFrom = Math.floor(new Date(customFrom).getTime() / 1000);
    const expectedTo = Math.floor(new Date(customTo).getTime() / 1000);

    await page.goto('/waf');

    await page.getByRole('button', { name: '24h' }).click();
    await expect(page).toHaveURL(/range=24h/);
    await expect(page.getByRole('button', { name: '24h' })).toBeVisible();

    await page.getByRole('button', { name: '7d' }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect(page.getByRole('button', { name: '7d' })).toBeVisible();

    await page.getByRole('button', { name: '30d' }).click();
    await expect(page).toHaveURL(/range=30d/);
    await expect(page.getByRole('button', { name: '30d' })).toBeVisible();

    await page.getByRole('button', { name: 'Custom' }).click();
    const dateInputs = page.locator('input[type="datetime-local"]');
    await expect(dateInputs).toHaveCount(2);
    await dateInputs.nth(0).fill(customFrom);
    await dateInputs.nth(1).fill(customTo);
    await page.getByRole('button', { name: /apply range/i }).click();

    await expect(page).toHaveURL(new RegExp(`range=custom.*from=${expectedFrom}.*to=${expectedTo}`));
    await expect(dateInputs.nth(0)).toHaveValue(customFrom);
    await expect(dateInputs.nth(1)).toHaveValue(customTo);

    await page.getByRole('button', { name: 'All time' }).click();
    await expect(page).not.toHaveURL(/range=/);
    await expect(page).not.toHaveURL(/from=/);
    await expect(page).not.toHaveURL(/to=/);
    await expect(page.getByRole('button', { name: 'All time' })).toBeVisible();
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  });

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
