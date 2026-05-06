import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The settings page has its own sidebar (`aria-label="Settings navigation"`),
 *  separate from the global dashboard sidebar. Use this selector everywhere. */
const SETTINGS_SIDEBAR = 'aside[aria-label="Settings navigation"]';

/** Navigate to a specific settings section via the sidebar. */
async function goToSection(page: Page, sectionName: string) {
  await page.goto('/settings');
  const sidebar = page.locator(SETTINGS_SIDEBAR);
  const navButton = sidebar.getByRole('button', { name: sectionName, exact: true });
  await expect(navButton).toBeVisible({ timeout: 10_000 });
  await navButton.click();
}

// ─── Page load & layout ──────────────────────────────────────────────────────

test.describe('Settings — page load & layout', () => {
  test('settings page loads without redirecting to login', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('settings page defaults to Instance Sync section', async ({ page }) => {
    await page.goto('/settings');
    // The detail header should show Instance Sync
    await expect(page.getByRole('heading', { name: 'Instance Sync' })).toBeVisible();
  });

  test('sidebar is visible and shows all group headers', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('System')).toBeVisible();
    await expect(sidebar.getByText('Networking')).toBeVisible();
    await expect(sidebar.getByText('Security')).toBeVisible();
    await expect(sidebar.getByText('Observability')).toBeVisible();
  });

  test('sidebar shows all 10 navigation items', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    const expectedItems = [
      'Instance Sync', 'General',
      'DNS Providers', 'DNS Resolvers', 'Upstream DNS Pinning',
      'Global Geoblocking', 'Authentik Defaults', 'OAuth Providers',
      'Metrics & Monitoring', 'Access Logging',
    ];
    for (const name of expectedItems) {
      await expect(sidebar.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('sidebar search button is visible with keyboard hint', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);
    await expect(sidebar.getByText('Jump to setting...')).toBeVisible();
    await expect(sidebar.locator('kbd')).toBeVisible();
  });
});

// ─── Sidebar navigation ─────────────────────────────────────────────────────

test.describe('Settings — sidebar navigation', () => {
  test('clicking a nav item switches the detail pane', async ({ page }) => {
    await page.goto('/settings');
    // Default: Instance Sync
    await expect(page.getByRole('heading', { name: 'Instance Sync' })).toBeVisible();

    // Navigate to General
    await page.locator(SETTINGS_SIDEBAR).getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
    // Instance Sync heading should no longer be visible
    await expect(page.getByRole('heading', { name: 'Instance Sync' })).not.toBeVisible();
  });

  test('breadcrumb shows correct group for each section', async ({ page }) => {
    await page.goto('/settings');
    const breadcrumb = page.getByTestId('settings-breadcrumb');

    // Instance Sync is under System
    await expect(breadcrumb.getByText('System')).toBeVisible();

    // Navigate to DNS Providers under Networking
    await page.locator(SETTINGS_SIDEBAR).getByRole('button', { name: 'DNS Providers', exact: true }).click();
    await expect(breadcrumb.getByText('Networking')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'DNS Providers' })).toBeVisible();
  });

  test('navigating through all sections renders correct headings', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);

    const sections = [
      'Instance Sync', 'General',
      'DNS Providers', 'DNS Resolvers', 'Upstream DNS Pinning',
      'Global Geoblocking', 'Authentik Defaults', 'OAuth Providers',
      'Metrics & Monitoring', 'Access Logging',
    ];

    for (const name of sections) {
      await sidebar.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name })).toBeVisible();
    }
  });

  test('only one section is visible at a time', async ({ page }) => {
    await page.goto('/settings');

    // On the Instance Sync section, General's save button should not be present
    await expect(page.getByRole('button', { name: /save general settings/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /save instance mode/i })).toBeVisible();

    // Switch to General
    await page.locator(SETTINGS_SIDEBAR).getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save instance mode/i })).not.toBeVisible();
  });
});

// ─── Cmd-K palette ───────────────────────────────────────────────────────────

test.describe('Settings — Cmd-K palette', () => {
  test('Cmd+K opens the command palette', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder(/jump to a setting/i)).toBeVisible();
  });

  test('clicking the search button opens the command palette', async ({ page }) => {
    await page.goto('/settings');
    await page.locator(SETTINGS_SIDEBAR).getByText('Jump to setting...').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('palette shows all settings items', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Instance Sync')).toBeVisible();
    await expect(dialog.getByText('General')).toBeVisible();
    await expect(dialog.getByText('DNS Providers')).toBeVisible();
    await expect(dialog.getByText('Metrics & Monitoring')).toBeVisible();
  });

  test('typing in the palette filters results', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder(/jump to a setting/i);
    // Use "geob" — specific enough that cmdk fuzzy matching won't hit unrelated items
    // ("dns" fuzzy-matches "Instance Sync" via d-n-s in "Standalone, coordination, System")
    await input.fill('geob');
    await expect(dialog.getByText('Global Geoblocking')).toBeVisible();
    // Non-matching items should be hidden
    await expect(dialog.getByText('Instance Sync')).not.toBeVisible();
  });

  test('selecting a palette result navigates to that section', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    const input = dialog.getByPlaceholder(/jump to a setting/i);
    await input.fill('logging');
    await dialog.getByText('Access Logging').click();
    // Palette should close
    await expect(dialog).not.toBeVisible();
    // Detail pane should show logging section
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();
  });

  test('Escape closes the palette', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('palette shows "no match" for gibberish query', async ({ page }) => {
    await page.goto('/settings');
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/jump to a setting/i).fill('zzzzxyzzy');
    await expect(dialog.getByText(/no settings match/i)).toBeVisible();
  });
});

// ─── Instance Sync section ───────────────────────────────────────────────────

test.describe('Settings — Instance Sync', () => {
  test('shows mode selector with Standalone/Master/Slave options', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Instance Sync' })).toBeVisible();
    // The mode select trigger should be present
    await expect(page.getByRole('combobox')).toBeVisible();
    await expect(page.getByRole('button', { name: /save instance mode/i })).toBeVisible();
  });

  test('mode selector displays the three options', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'Standalone' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Master' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Slave' })).toBeVisible();
  });
});

// ─── General section ─────────────────────────────────────────────────────────

test.describe('Settings — General', () => {
  // FormRow uses <div> labels (not <Label htmlFor>), so we target inputs by name attribute
  test('shows primary domain and ACME email fields', async ({ page }) => {
    await goToSection(page, 'General');
    await expect(page.locator('input[name="primaryDomain"]')).toBeVisible();
    await expect(page.locator('input[name="acmeEmail"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeVisible();
  });

  test('fill primary domain and save', async ({ page }) => {
    await goToSection(page, 'General');
    const domainInput = page.locator('input[name="primaryDomain"]');
    await domainInput.fill('test.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByRole('button', { name: /save general settings/i })).toBeEnabled({ timeout: 10_000 });
  });

  test('primary domain persists after save and page reload', async ({ page }) => {
    await goToSection(page, 'General');
    const domainInput = page.locator('input[name="primaryDomain"]');
    await domainInput.fill('persist-test.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    // Reload and navigate back
    await goToSection(page, 'General');
    await expect(page.locator('input[name="primaryDomain"]')).toHaveValue('persist-test.local');

    // Reset
    await page.locator('input[name="primaryDomain"]').fill('caddyproxymanager.com');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('ACME email field accepts email input', async ({ page }) => {
    await goToSection(page, 'General');
    const emailInput = page.locator('input[name="acmeEmail"]');
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');
  });
});

// ─── DNS Providers section ───────────────────────────────────────────────────

test.describe('Settings — DNS Providers', () => {
  test('shows provider selector and add form', async ({ page }) => {
    await goToSection(page, 'DNS Providers');
    await expect(page.getByRole('heading', { name: 'DNS Providers' })).toBeVisible();
    // Should have a select for provider
    await expect(page.getByText(/select/i).first()).toBeVisible();
  });

  test('selecting a provider reveals its credential fields', async ({ page }) => {
    await goToSection(page, 'DNS Providers');
    // Click the provider select and pick one (Cloudflare or first available)
    const selects = page.getByRole('combobox');
    // Find the provider select (the one with "Select..." text)
    const providerSelect = selects.last();
    await providerSelect.click();
    // Select the first non-"Select" option
    const firstProvider = page.getByRole('option').filter({ hasNot: page.locator('text=/select/i') }).first();
    await firstProvider.click();
    // Credential input fields should now appear
    // Most providers have at least one field (API token, etc.)
    const formInputs = page.locator('form#dnsp-add-form input[type="text"], form#dnsp-add-form input[type="password"]');
    await expect(formInputs.first()).toBeVisible({ timeout: 3000 });
  });
});

// ─── DNS Resolvers section ───────────────────────────────────────────────────

test.describe('Settings — DNS Resolvers', () => {
  test('shows enable checkbox and resolver textareas', async ({ page }) => {
    await goToSection(page, 'DNS Resolvers');
    await expect(page.getByRole('heading', { name: 'DNS Resolvers' })).toBeVisible();
    await expect(page.getByLabel('Enable custom DNS resolvers')).toBeVisible();
    await expect(page.locator('textarea[name="resolvers"]')).toBeVisible();
    await expect(page.locator('textarea[name="fallbacks"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save dns settings/i })).toBeVisible();
  });

  test('timeout field is visible', async ({ page }) => {
    await goToSection(page, 'DNS Resolvers');
    await expect(page.locator('input[name="timeout"]')).toBeVisible();
  });
});

// ─── Upstream DNS Pinning section ────────────────────────────────────────────

test.describe('Settings — Upstream DNS Pinning', () => {
  test('shows enable checkbox and address family selector', async ({ page }) => {
    await goToSection(page, 'Upstream DNS Pinning');
    await expect(page.getByRole('heading', { name: 'Upstream DNS Pinning' })).toBeVisible();
    await expect(page.getByLabel('Enable upstream DNS pinning')).toBeVisible();
    await expect(page.getByRole('button', { name: /save upstream dns/i })).toBeVisible();
  });

  test('address family selector shows three options', async ({ page }) => {
    await goToSection(page, 'Upstream DNS Pinning');
    await page.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: /both/i })).toBeVisible();
    await expect(page.getByRole('option', { name: /ipv6 only/i })).toBeVisible();
    await expect(page.getByRole('option', { name: /ipv4 only/i })).toBeVisible();
  });
});

// ─── Authentik Defaults section ──────────────────────────────────────────────

test.describe('Settings — Authentik Defaults', () => {
  test('shows outpost domain, upstream, and auth endpoint fields', async ({ page }) => {
    await goToSection(page, 'Authentik Defaults');
    await expect(page.getByRole('heading', { name: 'Authentik Defaults' })).toBeVisible();
    await expect(page.locator('input[name="outpostDomain"]')).toBeVisible();
    await expect(page.locator('input[name="outpostUpstream"]')).toBeVisible();
    await expect(page.locator('input[name="authEndpoint"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save authentik/i })).toBeVisible();
  });

  test('fields have appropriate placeholders', async ({ page }) => {
    await goToSection(page, 'Authentik Defaults');
    await expect(page.locator('input[name="outpostDomain"]')).toHaveAttribute('placeholder', 'outpost.goauthentik.io');
    await expect(page.locator('input[name="outpostUpstream"]')).toHaveAttribute('placeholder', 'http://authentik-server:9000');
  });
});

// ─── OAuth Providers section ─────────────────────────────────────────────────

test.describe('Settings — OAuth Providers', () => {
  test('section renders with Add Provider button', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await expect(page.getByRole('heading', { name: 'OAuth Providers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /add provider/i })).toBeVisible();
  });

  test('clicking Add Provider opens dialog', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await page.getByRole('button', { name: /add provider/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/name/i)).toBeVisible();
    await expect(dialog.getByLabel(/client id/i)).toBeVisible();
    await expect(dialog.getByLabel(/client secret/i)).toBeVisible();
  });

  test('create and delete an OAuth provider', async ({ page }) => {
    await goToSection(page, 'OAuth Providers');
    await page.getByRole('button', { name: /add provider/i }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^name/i).fill('E2E Test Provider');
    await dialog.getByLabel(/client id/i).fill('test-client-id-12345');
    await dialog.getByLabel(/client secret/i).fill('test-client-secret-12345');
    // Skip issuer URL — it's optional and avoids potential OIDC discovery issues
    await dialog.getByRole('button', { name: /create provider/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });

    // Provider should appear in the list
    await expect(page.getByText('E2E Test Provider')).toBeVisible({ timeout: 10_000 });

    // Scope delete to the provider card containing the test provider
    const providerCard = page.locator('div.rounded-md').filter({ hasText: 'E2E Test Provider' });
    await providerCard.getByRole('button', { name: 'Delete provider' }).click();
    await providerCard.getByRole('button', { name: /^confirm$/i }).click();
    await expect(page.getByText('E2E Test Provider')).not.toBeVisible({ timeout: 10_000 });
  });
});

// ─── Global Geoblocking section ──────────────────────────────────────────────

test.describe('Settings — Global Geoblocking', () => {
  test('section renders with save button', async ({ page }) => {
    await goToSection(page, 'Global Geoblocking');
    await expect(page.getByRole('heading', { name: 'Global Geoblocking' })).toBeVisible();
    await expect(page.getByRole('button', { name: /save geoblocking/i })).toBeVisible();
  });
});

// ─── Metrics & Monitoring section ────────────────────────────────────────────

test.describe('Settings — Metrics & Monitoring', () => {
  test('shows enable checkbox and port field', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();
    await expect(page.getByLabel('Enable metrics endpoint')).toBeVisible();
    await expect(page.locator('input[name="port"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /save metrics/i })).toBeVisible();
  });

  test('port field has default value 9090', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.locator('input[name="port"]')).toHaveValue('9090');
  });

  test('info callout mentions Docker network scrape endpoint', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    await expect(page.getByText(/caddy-proxy-manager-caddy/i)).toBeVisible();
  });
});

// ─── Access Logging section ──────────────────────────────────────────────────

test.describe('Settings — Access Logging', () => {
  test('shows enable checkbox and format selector', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();
    await expect(page.getByLabel('Enable access logging')).toBeVisible();
    await expect(page.getByRole('button', { name: /save logging/i })).toBeVisible();
  });

  test('format selector has JSON and Console options', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await page.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: 'JSON' })).toBeVisible();
    await expect(page.getByRole('option', { name: /console/i })).toBeVisible();
  });

  test('info callout mentions docker exec command', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    await expect(page.getByText(/docker exec/)).toBeVisible();
  });
});

// ─── Cross-section navigation ────────────────────────────────────────────────

test.describe('Settings — cross-section navigation', () => {
  test('rapid section switching renders correct content each time', async ({ page }) => {
    await page.goto('/settings');
    const sidebar = page.locator(SETTINGS_SIDEBAR);

    // Click General → verify heading → click Metrics → verify heading
    await sidebar.getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Metrics & Monitoring', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'OAuth Providers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'OAuth Providers' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Instance Sync', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Instance Sync' })).toBeVisible();
  });

  test('Cmd-K to navigate, then sidebar to navigate back', async ({ page }) => {
    await page.goto('/settings');

    // Use Cmd-K to go to Access Logging
    await page.keyboard.press('Meta+k');
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/jump to a setting/i).fill('access');
    await dialog.getByText('Access Logging').click();
    await expect(page.getByRole('heading', { name: 'Access Logging' })).toBeVisible();

    // Then use sidebar to go to General
    await page.locator(SETTINGS_SIDEBAR).getByRole('button', { name: 'General', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });
});

// ─── Mobile layout ───────────────────────────────────────────────────────────

test.describe('Settings — mobile layout', () => {
  test.use({ viewport: { width: 393, height: 852 } });

  test('sidebar is hidden on mobile', async ({ page }) => {
    await page.goto('/settings');
    // The <aside> sidebar should not be visible on mobile
    await expect(page.locator(SETTINGS_SIDEBAR)).not.toBeVisible();
  });

  test('mobile pill navigation is visible', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await expect(mobileNav.getByRole('button', { name: 'Instance Sync' })).toBeVisible();
  });

  test('mobile search button is visible', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await expect(mobileNav.getByText('Jump to setting...')).toBeVisible();
  });

  test('clicking a mobile pill switches the section', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    const generalPill = mobileNav.getByRole('button', { name: 'General', exact: true });
    await expect(generalPill).toBeVisible();
    await generalPill.click();
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  });

  test('mobile search opens Cmd-K palette', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await mobileNav.getByText('Jump to setting...').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('Cmd-K palette works on mobile', async ({ page }) => {
    await page.goto('/settings');
    const mobileNav = page.getByTestId('mobile-settings-nav');
    await mobileNav.getByText('Jump to setting...').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/jump to a setting/i).fill('metrics');
    await dialog.getByText('Metrics & Monitoring').click();
    await expect(page.getByRole('heading', { name: 'Metrics & Monitoring' })).toBeVisible();
  });

  test('detail content does not overflow viewport width', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 393;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });
});

// ─── Form submissions via API ────────────────────────────────────────────────

test.describe('Settings — form data round-trip via API', () => {
  const API_SETTINGS_GENERAL = 'http://localhost:3000/api/v1/settings/general';
  const API_SETTINGS_METRICS = 'http://localhost:3000/api/v1/settings/metrics';
  const API_SETTINGS_LOGGING = 'http://localhost:3000/api/v1/settings/logging';

  test('general settings: UI save is reflected in API', async ({ page }) => {
    await goToSection(page, 'General');
    await page.locator('input[name="primaryDomain"]').fill('api-roundtrip.local');
    await page.getByRole('button', { name: /save general settings/i }).click();
    await expect(page.getByText(/saved|success/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_GENERAL);
    const data = await res.json();
    expect(data.primaryDomain).toBe('api-roundtrip.local');

    // Reset
    await page.request.put(API_SETTINGS_GENERAL, {
      data: { primaryDomain: 'caddyproxymanager.com', acmeEmail: '' },
    });
  });

  test('metrics settings: enable and change port via UI, verify via API', async ({ page }) => {
    await goToSection(page, 'Metrics & Monitoring');
    const enableCheckbox = page.getByLabel('Enable metrics endpoint');
    if (!(await enableCheckbox.isChecked())) {
      await enableCheckbox.click();
    }
    await page.locator('input[name="port"]').fill('9191');
    await page.getByRole('button', { name: /save metrics/i }).click();
    await expect(page.getByText(/saved|success|applied/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_METRICS);
    const data = await res.json();
    expect(data.enabled).toBe(true);
    expect(data.port).toBe(9191);

    // Reset
    await page.request.put(API_SETTINGS_METRICS, { data: { enabled: false, port: 9090 } });
  });

  test('logging settings: change format via UI, verify via API', async ({ page }) => {
    await goToSection(page, 'Access Logging');
    // Enable logging
    const enableCheckbox = page.getByLabel('Enable access logging');
    if (!(await enableCheckbox.isChecked())) {
      await enableCheckbox.click();
    }
    // Change format to console
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /console/i }).click();
    await page.getByRole('button', { name: /save logging/i }).click();
    await expect(page.getByText(/saved|success|applied/i).first()).toBeVisible({ timeout: 10_000 });

    const res = await page.request.get(API_SETTINGS_LOGGING);
    const data = await res.json();
    expect(data.format).toBe('console');

    // Reset
    await page.request.put(API_SETTINGS_LOGGING, { data: { enabled: false, format: 'json' } });
  });
});

// ─── Detail header ───────────────────────────────────────────────────────────

test.describe('Settings — detail header', () => {
  test('header shows description text for each section', async ({ page }) => {
    await goToSection(page, 'General');
    await expect(page.getByText('Primary domain and ACME contact email')).toBeVisible();

    await page.locator(SETTINGS_SIDEBAR).getByRole('button', { name: 'DNS Providers', exact: true }).click();
    await expect(page.getByText('Provider credentials for ACME DNS-01')).toBeVisible();
  });

  test('header breadcrumb trail includes Settings prefix', async ({ page }) => {
    await page.goto('/settings');
    const breadcrumb = page.getByTestId('settings-breadcrumb');
    await expect(breadcrumb.getByText('Settings')).toBeVisible();
  });
});
