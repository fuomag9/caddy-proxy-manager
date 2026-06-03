import { test, expect } from '@playwright/test';

const API_PROXY_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';
const API_AUTHENTIK_SETTINGS = 'http://localhost:3000/api/v1/settings/authentik';

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

  /**
   * Regression test for #120: Toggling a proxy host disabled then re-enabled
   * via the row-level switch wiped custom configs (redirects, rewrite,
   * location_rules) because they were not included in existingMeta when
   * updateProxyHost was called with only { enabled }.
   */
  test('toggling enabled/disabled preserves redirects and rewrite config (#120)', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    // Create a host with redirect rules and a rewrite config via the REST API
    const createResp = await page.request.post(API_PROXY_HOSTS, {
      headers: { Origin: origin },
      data: {
        name: 'Toggle Persistence Test',
        domains: ['toggle-persist.local'],
        upstreams: ['localhost:9988'],
        redirects: [{ from: '/.well-known/carddav', to: '/remote.php/dav/', status: 308 }],
        rewrite: { path_prefix: '/app' },
      },
    });
    expect(createResp.ok()).toBeTruthy();
    const created = await createResp.json() as { id: number; redirects: unknown[]; rewrite: unknown };
    expect(created.redirects).toHaveLength(1);
    expect(created.rewrite).toBeDefined();

    try {
      await page.reload();
      await expect(page.getByRole('table').getByText('Toggle Persistence Test')).toBeVisible({ timeout: 10000 });

      // Click the Switch in the row to disable the host
      const row = page.locator('tr', { hasText: 'Toggle Persistence Test' });
      const rowSwitch = row.getByRole('switch').first();
      await expect(rowSwitch).toHaveAttribute('data-state', 'checked');
      await rowSwitch.click();
      await expect(rowSwitch).toHaveAttribute('data-state', 'unchecked', { timeout: 10000 });

      // Verify redirects and rewrite survive the disable toggle
      const afterDisable = await (await page.request.get(`${API_PROXY_HOSTS}/${created.id}`)).json() as {
        redirects: unknown[]; rewrite: unknown; enabled: boolean
      };
      expect(afterDisable.enabled).toBe(false);
      expect(afterDisable.redirects).toHaveLength(1);
      expect(afterDisable.rewrite).toBeDefined();

      // Re-enable
      await rowSwitch.click();
      await expect(rowSwitch).toHaveAttribute('data-state', 'checked', { timeout: 10000 });

      // Verify redirects and rewrite survive the re-enable toggle
      const afterEnable = await (await page.request.get(`${API_PROXY_HOSTS}/${created.id}`)).json() as {
        redirects: unknown[]; rewrite: unknown; enabled: boolean
      };
      expect(afterEnable.enabled).toBe(true);
      expect(afterEnable.redirects).toHaveLength(1);
      expect(afterEnable.rewrite).toBeDefined();
    } finally {
      await page.request.delete(`${API_PROXY_HOSTS}/${created.id}`, { headers: { Origin: origin } });
    }
  });

  test('create host Authentik fields are prefilled from global defaults (#141)', async ({ page }) => {
    const origin = new URL(page.url()).origin;
    const defaultSettings = {
      outpostDomain: 'auth.example.test',
      outpostUpstream: 'http://authentik.internal:9000',
      authEndpoint: '/outpost.goauthentik.io/auth/caddy',
    };

    const originalSettingsResp = await page.request.get(API_AUTHENTIK_SETTINGS);
    expect(originalSettingsResp.ok()).toBeTruthy();
    const originalSettings = await originalSettingsResp.json() as Partial<typeof defaultSettings>;

    try {
      await page.goto('/settings');
      const sidebar = page.locator('aside[aria-label="Settings navigation"]');
      const navBtn = sidebar.getByRole('button', { name: 'Authentik Defaults', exact: true });
      await expect(navBtn).toBeVisible({ timeout: 10_000 });
      await navBtn.click();

      await page.locator('input[name="outpostDomain"]').fill(defaultSettings.outpostDomain);
      await page.locator('input[name="outpostUpstream"]').fill(defaultSettings.outpostUpstream);
      await page.locator('input[name="authEndpoint"]').fill(defaultSettings.authEndpoint);
      await page.getByRole('button', { name: /save authentik defaults/i }).click();
      await expect(page.getByText(/authentik defaults saved successfully/i)).toBeVisible({ timeout: 10000 });

      await page.goto('/proxy-hosts');
      await page.getByRole('button', { name: /create host/i }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      const dialog = page.getByRole('dialog');
      const authentikSection = dialog.locator('div:has(> input[name="authentikPresent"])');
      const authentikSwitch = authentikSection.getByRole('switch');
      await expect(authentikSwitch).toHaveAttribute('data-state', 'unchecked');

      await authentikSwitch.click();
      await expect(authentikSwitch).toHaveAttribute('data-state', 'checked');

      await expect(dialog.locator('input[name="authentikOutpostDomain"]')).toHaveValue(defaultSettings.outpostDomain);
      await expect(dialog.locator('input[name="authentikOutpostUpstream"]')).toHaveValue(defaultSettings.outpostUpstream);
      await expect(dialog.locator('input[name="authentikAuthEndpoint"]')).toHaveValue(defaultSettings.authEndpoint);
    } finally {
      if (originalSettings.outpostDomain && originalSettings.outpostUpstream) {
        const restoreResp = await page.request.put(API_AUTHENTIK_SETTINGS, {
          headers: { Origin: origin },
          data: {
            outpostDomain: originalSettings.outpostDomain,
            outpostUpstream: originalSettings.outpostUpstream,
            authEndpoint: originalSettings.authEndpoint ?? '',
          },
        });
        expect(restoreResp.ok()).toBeTruthy();
      }
    }
  });

  /**
   * Regression: per-host geoblock "Override global" toggle was silently dropped.
   *
   * The form action's `parseGeoBlockConfig` returned `geoblock_mode` (snake_case)
   * while ProxyHostInput uses `geoblockMode` (camelCase), so the spread into
   * createProxyHost / updateProxyHost dropped the field and the host always
   * stayed in merge mode regardless of UI state.
   */
  test('per-host geoblock override mode persists after save', async ({ page }) => {
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('Geoblock Override Host');
    await page.getByLabel(/domains/i).fill('geoblock-override.local');
    await page.getByPlaceholder('10.0.0.5:8080').fill('localhost:9991');

    // Enable per-host geoblock (the rose-colored card with a Switch).
    const dialog = page.getByRole('dialog');
    const geoCard = dialog.locator('div:has(> input[name="geoblockPresent"])');
    await geoCard.scrollIntoViewIfNeeded();
    const geoSwitch = geoCard.getByRole('switch').first();
    await geoSwitch.click();
    await expect(geoSwitch).toHaveAttribute('data-state', 'checked');

    // Pick "Override global" from the two-tile mode selector.
    await geoCard.getByText('Override global').click();

    await dialog.getByRole('button', { name: /^create$/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table').getByText('Geoblock Override Host')).toBeVisible({ timeout: 10000 });

    // Verify the API reflects the override mode (this is what was broken).
    const listResp = await page.request.get(API_PROXY_HOSTS);
    const hosts = (await listResp.json()) as Array<{ id: number; name: string; geoblockMode: string }>;
    const created = hosts.find((h) => h.name === 'Geoblock Override Host');
    expect(created).toBeDefined();
    expect(created!.geoblockMode).toBe('override');

    // Reopen the edit dialog and confirm the mode tile is still selected.
    const row = page.locator('tr', { hasText: 'Geoblock Override Host' });
    await row.getByRole('button').first().click();
    await page.getByRole('menuitem', { name: /edit/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const editGeoCard = page.getByRole('dialog').locator('div:has(> input[name="geoblockPresent"])');
    // Selected mode tile carries the highlighted "border-yellow-500" class.
    await expect(editGeoCard.locator('div.border-yellow-500', { hasText: 'Override global' })).toBeVisible();

    // Switch back to merge and verify that round-trips too.
    await editGeoCard.getByText('Merge with global').click();
    await page.getByRole('dialog').getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 });

    const listResp2 = await page.request.get(API_PROXY_HOSTS);
    const hosts2 = (await listResp2.json()) as Array<{ name: string; geoblockMode: string }>;
    const updated = hosts2.find((h) => h.name === 'Geoblock Override Host');
    expect(updated!.geoblockMode).toBe('merge');
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

  /**
   * The Features column renders a "Forward Auth" badge when a host has CPM
   * forward auth enabled. This badge was previously missing even though the
   * feature was fully supported by the data model and edit dialog.
   */
  test('Forward Auth feature badge shows for hosts with CPM forward auth enabled', async ({ page }) => {
    const origin = new URL(page.url()).origin;

    // Host WITH forward auth enabled. Note: names deliberately avoid the
    // substring "Forward Auth" so the badge assertions match the badge text
    // (asserted with exact:true) and never the host's name cell.
    const withResp = await page.request.post(API_PROXY_HOSTS, {
      headers: { Origin: origin },
      data: {
        name: 'FwdAuth Badge Host',
        domains: ['fwdauth-badge.local'],
        upstreams: ['localhost:9777'],
        cpmForwardAuth: { enabled: true },
      },
    });
    expect(withResp.ok()).toBeTruthy();
    const withHost = await withResp.json() as { id: number; cpmForwardAuth: { enabled: boolean } | null };
    expect(withHost.cpmForwardAuth?.enabled).toBe(true);

    // Host WITHOUT forward auth — used to confirm the badge is conditional
    const withoutResp = await page.request.post(API_PROXY_HOSTS, {
      headers: { Origin: origin },
      data: {
        name: 'Plain Proxy Host',
        domains: ['plain-proxy.local'],
        upstreams: ['localhost:9778'],
      },
    });
    expect(withoutResp.ok()).toBeTruthy();
    const withoutHost = await withoutResp.json() as { id: number };

    try {
      await page.reload();

      const enabledRow = page.locator('tr', { hasText: 'FwdAuth Badge Host' });
      await expect(enabledRow.getByText('Forward Auth', { exact: true })).toBeVisible({ timeout: 10000 });

      // The host without forward auth must NOT render the badge.
      const disabledRow = page.locator('tr', { hasText: 'Plain Proxy Host' });
      await expect(disabledRow).toBeVisible({ timeout: 10000 });
      await expect(disabledRow.getByText('Forward Auth', { exact: true })).toHaveCount(0);
    } finally {
      await page.request.delete(`${API_PROXY_HOSTS}/${withHost.id}`, { headers: { Origin: origin } });
      await page.request.delete(`${API_PROXY_HOSTS}/${withoutHost.id}`, { headers: { Origin: origin } });
    }
  });
});
