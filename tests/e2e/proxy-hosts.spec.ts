import { test, expect } from '@playwright/test';

const API_PROXY_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';

test.describe('Proxy Hosts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/proxy-hosts');
  });

  test('page loads with Create Host button visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /create host/i })).toBeVisible();
  });

  test('clicking Create Host opens a dialog with form fields', async ({ page }) => {
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel(/domains/i)).toBeVisible();
  });

  test('create a proxy host — appears in the table', async ({ page }) => {
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('E2E Test Host');
    await page.getByLabel(/domains/i).fill('e2etest.local');
    // Upstream field uses placeholder text, not a label
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:9999');

    await page.getByRole('button', { name: /^create$/i }).click();

    // Dialog should close and host appear in table
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table').getByText('E2E Test Host')).toBeVisible({ timeout: 10000 });
  });

  test('clicking Name / Domain header sorts the table', async ({ page }) => {
    const sortBtn = page.getByRole('button', { name: 'Name / Domain' });
    await expect(sortBtn).toBeVisible({ timeout: 10_000 });

    // Click to sort ascending
    await sortBtn.click();
    await expect(page).toHaveURL(/sortBy=name/);
    await expect(page).toHaveURL(/sortDir=asc/);

    // Click again to toggle to descending
    await sortBtn.click();
    await expect(page).toHaveURL(/sortDir=desc/);
  });

  test('clicking Status header sorts by enabled state', async ({ page }) => {
    const sortBtn = page.getByRole('button', { name: 'Status' });
    await expect(sortBtn).toBeVisible();

    await sortBtn.click();
    await expect(page).toHaveURL(/sortBy=enabled/);
  });

  /**
   * Regression test for #119: Advanced Options (HSTS Subdomains, Skip HTTPS
   * Validation) were not saved because the form field names used camelCase
   * (hstsSubdomains, skipHttpsHostnameValidation) while the server action
   * expected snake_case (hsts_subdomains, skip_https_hostname_validation).
   */
  test('advanced options are saved and persist after edit (#119)', async ({ page }) => {
    // Create a host (defaults: HSTS Subdomains ON, Skip HTTPS OFF)
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('Advanced Options Test');
    await page.getByLabel(/domains/i).fill('advanced-opts-test.local');
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:9990');
    await page.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table').getByText('Advanced Options Test')).toBeVisible({ timeout: 10000 });

    try {
      // Find the created host in the API to verify initial state
      const listResp = await page.request.get(API_PROXY_HOSTS);
      const hosts = await listResp.json() as Array<{ id: number; name: string; hstsSubdomains: boolean; skipHttpsHostnameValidation: boolean }>;
      const created = hosts.find((h) => h.name === 'Advanced Options Test');
      expect(created).toBeDefined();
      expect(created!.hstsSubdomains).toBe(true);
      expect(created!.skipHttpsHostnameValidation).toBe(false);

      // Open edit dialog for the host
      const row = page.locator('tr', { hasText: 'Advanced Options Test' });
      await row.getByRole('button').first().click();
      await page.getByRole('menuitem', { name: /edit/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      // Locate Advanced Options toggles via their hidden _present inputs, which
      // uniquely identify each row and avoid ambiguity with ancestor divs.
      const dialog = page.getByRole('dialog');
      const hstsSwitch = dialog.locator('div:has(> input[name="hstsSubdomainsPresent"])').getByRole('switch');
      const skipSwitch = dialog.locator('div:has(> input[name="skipHttpsHostnameValidationPresent"])').getByRole('switch');

      // Verify initial state matches what was saved
      await expect(hstsSwitch).toHaveAttribute('data-state', 'checked');
      await expect(skipSwitch).toHaveAttribute('data-state', 'unchecked');

      // Toggle HSTS Subdomains OFF and Skip HTTPS Validation ON
      await hstsSwitch.click();
      await skipSwitch.click();

      await expect(hstsSwitch).toHaveAttribute('data-state', 'unchecked');
      await expect(skipSwitch).toHaveAttribute('data-state', 'checked');

      // Save the changes
      await dialog.getByRole('button', { name: /save changes/i }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

      // Verify via API that the settings were actually persisted
      const afterResp = await page.request.get(`${API_PROXY_HOSTS}/${created!.id}`);
      const after = await afterResp.json() as { hstsSubdomains: boolean; skipHttpsHostnameValidation: boolean };
      expect(after.hstsSubdomains).toBe(false);
      expect(after.skipHttpsHostnameValidation).toBe(true);

      // Reopen edit dialog and verify UI reflects saved state
      await row.getByRole('button').first().click();
      await page.getByRole('menuitem', { name: /edit/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const dialog2 = page.getByRole('dialog');
      const hstsSwitch2 = dialog2.locator('div:has(> input[name="hstsSubdomainsPresent"])').getByRole('switch');
      const skipSwitch2 = dialog2.locator('div:has(> input[name="skipHttpsHostnameValidationPresent"])').getByRole('switch');

      await expect(hstsSwitch2).toHaveAttribute('data-state', 'unchecked');
      await expect(skipSwitch2).toHaveAttribute('data-state', 'checked');

      await dialog2.getByRole('button', { name: /cancel|close/i }).first().click();
    } finally {
      // Cleanup: delete the test host
      const listResp2 = await page.request.get(API_PROXY_HOSTS);
      const hosts2 = await listResp2.json() as Array<{ id: number; name: string }>;
      const toDelete = hosts2.find((h) => h.name === 'Advanced Options Test');
      if (toDelete) {
        await page.request.delete(`${API_PROXY_HOSTS}/${toDelete.id}`);
      }
    }
  });

  test('delete proxy host removes it from table', async ({ page }) => {
    // Create one to delete
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('Host To Delete');
    await page.getByLabel(/domains/i).fill('delete-me.local');
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:7777');
    await page.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table').getByText('Host To Delete')).toBeVisible({ timeout: 10000 });

    // Open the dropdown menu for that row and click Delete
    const row = page.locator('tr', { hasText: 'Host To Delete' });
    await row.getByRole('button').first().click();
    await page.getByRole('menuitem', { name: /delete/i }).click();

    // Confirm dialog
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /^delete$/i }).click();

    // Wait for dialog to close, then verify the row is gone from the table
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('tbody').getByText('Host To Delete')).not.toBeVisible({ timeout: 5000 });
  });
});
