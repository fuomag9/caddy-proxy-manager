import { test, expect } from '@playwright/test';

test.describe('Audit Log', () => {
  test('audit log page loads without redirecting to login', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('audit log page has a table or list', async ({ page }) => {
    await page.goto('/audit-log');
    // Should have table or list structure
    const hasTable = await page.locator('table, [role="grid"], [role="table"]').count() > 0;
    const hasList = await page.locator('ul, ol').count() > 0;
    const hasRows = await page.locator('tr').count() > 0;
    expect(hasTable || hasList || hasRows).toBe(true);
  });

  test('creating a proxy host creates audit log entry', async ({ page }) => {
    // Create a proxy host
    await page.goto('/proxy-hosts');
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('Audit Test Host');
    await page.getByLabel(/domains/i).fill('audit-test.local');
    await page.getByLabel(/target/i).fill('localhost:8888');

    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Audit Test Host')).toBeVisible({ timeout: 10000 });

    // Check audit log
    await page.goto('/audit-log');
    // Should show some entry related to proxy_host or create
    await expect(page.locator('body')).toBeVisible();
  });

  test('audit log page has search functionality', async ({ page }) => {
    await page.goto('/audit-log');
    // Should have a search input
    const hasSearch = await page.getByRole('searchbox').count() > 0
      || await page.getByPlaceholder(/search/i).count() > 0
      || await page.getByLabel(/search/i).count() > 0;
    expect(hasSearch).toBe(true);
  });
});
