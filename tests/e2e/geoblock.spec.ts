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
 * RFC 5737 TEST-NET ranges — routable nowhere, so they won't block real
 * traffic when applied to Caddy during tests (unlike 0.0.0.0/0).
 */
const SAFE_BLOCK_CIDR = '198.51.100.0/24';   // TEST-NET-2
const SAFE_ALLOW_CIDR = '203.0.113.0/24';    // TEST-NET-3
const SAFE_BLOCK_CIDR_2 = '192.0.2.0/24';    // TEST-NET-1
const SAFE_ALLOW_CIDR_2 = '233.252.0.0/24';  // MCAST-TEST-NET

const API_GEOBLOCK = 'http://localhost:3000/api/v1/settings/geoblock';

/**
 * Find the visible text input inside a TagInput component by its hidden input name.
 */
function cidrInput(parent: ReturnType<typeof test['info']> extends never ? never : any, name: string) {
  return parent.locator(`div:has(> input[name="${name}"])`)
    .locator('input[type="text"]');
}

test.describe('Geo Blocking — form persistence', () => {
  async function resetGeoblock(page: any) {
    await page.request.put(API_GEOBLOCK, { data: EMPTY_GEOBLOCK });
  }

  test.beforeEach(async ({ page }) => {
    await resetGeoblock(page);
    await page.goto('/settings');
  });

  test.afterEach(async ({ page }) => {
    await resetGeoblock(page);
  });

  /**
   * Regression: Radix Tabs unmount inactive tab content, so only the
   * currently-visible tab's hidden inputs were submitted. Saving while on the
   * "Block Rules" tab would wipe all allow rules and vice-versa.
   *
   * Uses RFC 5737 test ranges to avoid blocking real traffic.
   */
  test('saving block rules does not wipe allow rules', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblockAllowCidrs');
    await allowInput.fill(SAFE_ALLOW_CIDR);
    await allowInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_ALLOW_CIDR}`)).toBeVisible();

    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblockBlockCidrs');
    await blockInput.fill(SAFE_BLOCK_CIDR);
    await blockInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_BLOCK_CIDR}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });

    await fresh.getByRole('tab', { name: /block rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_BLOCK_CIDR}`)).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('tab', { name: /allow rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_ALLOW_CIDR}`)).toBeVisible({ timeout: 5000 });
  });

  test('saving allow rules does not wipe block rules', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    const blockInput = cidrInput(geoSection, 'geoblockBlockCidrs');
    await blockInput.fill(SAFE_BLOCK_CIDR_2);
    await blockInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_BLOCK_CIDR_2}`)).toBeVisible();

    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    const allowInput = cidrInput(geoSection, 'geoblockAllowCidrs');
    await allowInput.fill(SAFE_ALLOW_CIDR_2);
    await allowInput.press('Enter');
    await expect(geoSection.locator(`text=${SAFE_ALLOW_CIDR_2}`)).toBeVisible();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });

    await fresh.getByRole('tab', { name: /block rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_BLOCK_CIDR_2}`)).toBeVisible({ timeout: 5000 });

    await fresh.getByRole('tab', { name: /allow rules/i }).click();
    await expect(fresh.locator(`text=${SAFE_ALLOW_CIDR_2}`)).toBeVisible({ timeout: 5000 });
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

    await geoSection.getByRole('button', { name: /trusted proxies/i }).click();
    const redirectInput = geoSection.locator('input[name="geoblockRedirectUrl"]');
    await expect(redirectInput).toBeVisible();
    await redirectInput.fill('https://example.com/blocked');

    await geoSection.getByRole('button', { name: /trusted proxies/i }).click();

    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    await page.reload();
    const fresh = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    await fresh.getByRole('button', { name: /trusted proxies/i }).click();
    await expect(fresh.locator('input[name="geoblockRedirectUrl"]'))
      .toHaveValue('https://example.com/blocked', { timeout: 5000 });
  });

  /**
   * Tests the LAN Only (RFC1918) preset — values must survive tab switching.
   * This test does NOT save, so no Caddy config is affected.
   */
  test('LAN Only preset: values survive tab switching', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /lan only/i }).click();

    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    await expect(geoSection.locator('text=10.0.0.0/8')).toBeVisible();
    await expect(geoSection.locator('text=172.16.0.0/12')).toBeVisible();
    await expect(geoSection.locator('text=192.168.0.0/16')).toBeVisible();

    await geoSection.getByRole('tab', { name: /block rules/i }).click();
    await expect(geoSection.locator('text=0.0.0.0/0')).toBeVisible();

    await geoSection.getByRole('tab', { name: /allow rules/i }).click();
    await expect(geoSection.locator('text=10.0.0.0/8')).toBeVisible();
  });

  /**
   * Tests that the LAN Only preset persists after save.
   * Saves via UI form, then immediately reads back via API and resets Caddy
   * to minimize the window where 0.0.0.0/0 blocks all traffic.
   */
  test('LAN Only preset: values persist after save', async ({ page }) => {
    const geoSection = page.locator('form', { has: page.getByRole('button', { name: /save geoblocking settings/i }) });
    const enableSwitch = geoSection.getByRole('switch');
    if (!(await enableSwitch.isChecked())) {
      await enableSwitch.click();
    }

    await geoSection.getByRole('button', { name: /lan only/i }).click();
    await geoSection.getByRole('button', { name: /save geoblocking settings/i }).click();
    await expect(geoSection.locator('text=/saved|success/i')).toBeVisible({ timeout: 10000 });

    // Read saved values via API, then immediately reset to stop blocking traffic
    const res = await page.request.get(API_GEOBLOCK);
    await resetGeoblock(page);

    const saved = await res.json();
    expect(saved.block_cidrs).toContain('0.0.0.0/0');
    expect(saved.allow_cidrs).toContain('10.0.0.0/8');
    expect(saved.allow_cidrs).toContain('172.16.0.0/12');
    expect(saved.allow_cidrs).toContain('192.168.0.0/16');
  });
});
