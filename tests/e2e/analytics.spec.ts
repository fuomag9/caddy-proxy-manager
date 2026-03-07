import { test, expect } from '@playwright/test';

test.describe('Analytics', () => {
  test('analytics page loads without redirecting to login', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('analytics page renders content', async ({ page }) => {
    await page.goto('/analytics');
    const hasContent = await page.locator('text=/analytics|traffic|requests|blocked/i').count() > 0;
    expect(hasContent).toBe(true);
  });

  test('analytics page shows summary stat cards', async ({ page }) => {
    await page.goto('/analytics');
    // These card headers are rendered by AnalyticsClient
    await expect(page.getByText('Total Requests', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Unique IPs', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Blocked Requests', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('analytics page has time range toggle buttons', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.getByRole('button', { name: '24h' })).toBeVisible();
    await expect(page.getByRole('button', { name: '7d' })).toBeVisible();
  });

  test('analytics page does not show error content', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('text=/500|internal server error/i')).not.toBeVisible();
  });
});
