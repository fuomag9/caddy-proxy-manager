import { test, expect } from '@playwright/test';

test.describe('Proxy Hosts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/proxy-hosts');
  });

  test('page loads with Add button visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /add/i })).toBeVisible();
  });

  test('clicking Add opens a dialog with form fields', async ({ page }) => {
    await page.getByRole('button', { name: /add/i }).click();
    // Dialog should open with domain and upstream fields
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel(/domain/i)).toBeVisible();
  });

  test('create a proxy host — appears in the table', async ({ page }) => {
    await page.getByRole('button', { name: /add/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill in the domain field
    const domainInput = page.getByLabel(/domain/i).first();
    await domainInput.fill('e2etest.local');

    // Fill upstream
    const upstreamInput = page.getByLabel(/upstream/i).first();
    await upstreamInput.fill('localhost:9999');

    // Submit
    await page.getByRole('button', { name: /save|create|add/i }).last().click();

    // Should appear in the table
    await expect(page.getByText('e2etest.local')).toBeVisible({ timeout: 10000 });
  });

  test('delete proxy host removes it from table', async ({ page }) => {
    // First create one
    await page.getByRole('button', { name: /add/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const domainInput = page.getByLabel(/domain/i).first();
    await domainInput.fill('delete-me.local');

    const upstreamInput = page.getByLabel(/upstream/i).first();
    await upstreamInput.fill('localhost:7777');

    await page.getByRole('button', { name: /save|create|add/i }).last().click();
    await expect(page.getByText('delete-me.local')).toBeVisible({ timeout: 10000 });

    // Find and click the delete button for this row
    const row = page.locator('tr', { hasText: 'delete-me.local' });
    await row.getByRole('button', { name: /delete/i }).click();

    // Confirm dialog if present
    const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect(page.getByText('delete-me.local')).not.toBeVisible({ timeout: 10000 });
  });
});
