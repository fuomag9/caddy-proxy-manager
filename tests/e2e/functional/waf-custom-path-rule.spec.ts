/**
 * Functional test: custom WAF path rule.
 *
 * Reproduces the reported setup:
 * - global WAF enabled
 * - per-host WAF set to merge
 * - custom SecRule on REQUEST_URI blocking /admin
 */
import { test, expect } from '@playwright/test';
import { createProxyHost } from '../../helpers/proxy-api';
import { httpGet, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-waf-custom-path.test';
const ECHO_BODY = 'echo-ok';
const BLOCK_RULE = 'SecRule REQUEST_URI "@contains /admin" "id:1001,phase:1,deny,status:403,msg:\'Blocked Path\',log"';

test.describe.serial('WAF Custom Path Rule', () => {
  test('setup: enable global WAF and create merge-mode host with custom path rule', async ({ page }) => {
    await page.goto('/waf');
    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeVisible();

    const wafSwitch = page.locator('#waf_enabled');
    const owaspCheckbox = page.locator('#waf_load_owasp_crs');

    if (await wafSwitch.getAttribute('data-state') !== 'checked') {
      await wafSwitch.click();
      await expect(wafSwitch).toHaveAttribute('data-state', 'checked');
    }
    if (await owaspCheckbox.getAttribute('data-state') !== 'checked') {
      await owaspCheckbox.click();
      await expect(owaspCheckbox).toHaveAttribute('data-state', 'checked');
    }

    await page.getByRole('button', { name: /save waf settings/i }).click();
    await expect(page.getByRole('button', { name: /save waf settings/i })).toBeEnabled({ timeout: 10_000 });

    await createProxyHost(page, {
      name: 'Functional WAF Custom Path Rule Test',
      domain: DOMAIN,
      upstream: 'echo-server:8080',
      enableWaf: true,
      wafMode: 'merge',
      wafCustomDirectives: BLOCK_RULE,
    });
    await waitForRoute(DOMAIN);
  });

  test('non-admin path still passes through', async () => {
    const res = await httpGet(DOMAIN, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('REQUEST_URI custom rule blocks /admin', async () => {
    const res = await httpGet(DOMAIN, '/admin');
    expect(res.status).toBe(403);
  });

  test('REQUEST_URI custom rule blocks /admin with query string', async () => {
    const res = await httpGet(DOMAIN, '/admin?via=test');
    expect(res.status).toBe(403);
  });
});
