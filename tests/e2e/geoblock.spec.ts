import { test, expect } from '@playwright/test';

/** Empty geoblock config used to reset state between tests. */
const EMPTY_GEOBLOCK = {
  enabled: false,
  block_countries: [], block_continents: [], block_asns: [], block_cidrs: [], block_ips: [],
  allow_countries: [], allow_continents: [], allow_asns: [], allow_cidrs: [], allow_ips: [],
  trusted_proxies: [], fail_closed: false,
  response_status: 403, response_body: 'Forbidden',
  response_headers: {}, redirect_url: '',
};

/**
 * Find the visible text input inside a TagInput component by its hidden input name.
 * TagInput renders: <div> <input type="hidden" name="..."> ... <input type="text"> </div>
 */
function cidrInput(parent: ReturnType<typeof test['info']> extends never ? never : any, name: string) {
  return parent.locator(`div:has(> input[name="${name}"])`)
    .locator('input[type="text"]');
}

test.describe('Geo Blocking — form persistence', () => {
  async function resetGeoblock(page: any) {
    await page.request.put('http://localhost:3000/api/v1/settings/geoblock', { data: EMPTY_GEOBLOCK });
  }

  test.beforeEach(async ({ page }) => {
    await resetGeoblock(page);
    await page.goto('/settings');
  });

  test.afterEach(async ({ page }) => {
    // Always reset after each test so concurrent workers don't hit block-all rules
    await resetGeoblock(page);
  });

  /**
   * Regression: Radix Tabs unmount inactive tab content, so only the
   * currently-visible tab's hidden inputs were submitted. Saving while on the
   * "Block Rules" tab would wipe all allow rules and vice-versa.
   */
  test('saving block rules does not wipe allow rules', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    // ── Switch to Allow tab and add a CIDR ───────────────────────────────
    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblock_allow_cidrs');
    await allowInput.fill('192.168.0.0/16');
    await allowInput.press('Enter');
    await expect(geoSection.locator('text=192.168.0.0/16')).toBeVisible();

    // ── Switch to Block tab and add a CIDR ───────────────────────────────
    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblock_block_cidrs');
    await blockInput.fill('0.0.0.0/0');
    await blockInput.press('Enter');
    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    // ── Save (on Block tab) ──────────────────────────────────────────────
    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // ── Reload and verify both rules survived ────────────────────────────
    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });

    await fresh.getByRole('tab', { name: /block rules/i }).click();
    await expect(fresh.locator('text=0.0.0.0/0')).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('tab', { name: /allow rules/i }).click();
    await expect(fresh.locator('text=192.168.0.0/16')).toBeVisible({ timeout: 5000 });
  });

  test('saving allow rules does not wipe block rules', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    // ── On Block tab, add a CIDR ─────────────────────────────────────────
    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblock_block_cidrs');
    await blockInput.fill('10.10.0.0/16');
    await blockInput.press('Enter');
    await expect(geoSection.locator('text=10.10.0.0/16')).toBeVisible();

    // ── Switch to Allow tab and add a CIDR ───────────────────────────────
    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblock_allow_cidrs');
    await allowInput.fill('172.16.0.0/12');
    await allowInput.press('Enter');
    await expect(geoSection.locator('text=172.16.0.0/12')).toBeVisible();

    // ── Save (on Allow tab) ──────────────────────────────────────────────
    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // ── Reload and verify both rules survived ────────────────────────────
    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });

    await fresh.getByRole('tab', { name: /block rules/i }).click();
    await expect(fresh.locator('text=10.10.0.0/16')).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('tab', { name: /allow rules/i }).click();
    await expect(fresh.locator('text=172.16.0.0/12')).toBeVisible({ timeout: 5000 });
  });

  /**
   * Regression: Radix Accordion unmounts closed content, so advanced
   * settings (redirect URL, trusted proxies, response status/body) were
   * wiped when saving with the accordion collapsed.
   */
  test('advanced settings survive save when accordion is collapsed', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    // ── Open accordion and set redirect URL ──────────────────────────────
    await geoSection.getByRole('button', { name: /trusted proxies/i }).click();
    const redirectInput = geoSection.locator('input[name="geoblock_redirect_url"]');
    await expect(redirectInput).toBeVisible();
    await redirectInput.fill('https://example.com/blocked');

    // ── Collapse accordion ───────────────────────────────────────────────
    await geoSection.getByRole('button', { name: /trusted proxies/i }).click();

    // ── Save ─────────────────────────────────────────────────────────────
    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // ── Reload and verify redirect URL is still set ──────────────────────
    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    await fresh.getByRole('button', { name: /trusted proxies/i }).click();
    const freshRedirectInput = fresh.locator('input[name="geoblock_redirect_url"]');
    await expect(freshRedirectInput).toHaveValue('https://example.com/blocked', { timeout: 5000 });
  });

  /**
   * Tests the LAN Only (RFC1918) preset button.
   */
  test('LAN Only preset fills RFC1918 allow CIDRs and block-all', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    // ── Click LAN Only preset ────────────────────────────────────────────
    await geoSection.getByRole('button', { name: /lan only/i }).click();

    // ── Verify block tab has 0.0.0.0/0 ──────────────────────────────────
    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    // ── Verify allow tab has RFC1918 ranges ──────────────────────────────
    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    await expect(geoSection.locator('text=10.0.0.0/8')).toBeVisible();
    await expect(geoSection.locator('text=172.16.0.0/12')).toBeVisible();
    await expect(geoSection.locator('text=192.168.0.0/16')).toBeVisible();
  });
});
