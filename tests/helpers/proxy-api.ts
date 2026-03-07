/**
 * Higher-level helpers for creating proxy hosts and access lists
 * in functional E2E tests.
 *
 * All helpers accept a Playwright `Page` (pre-authenticated via the
 * global storageState) so they integrate cleanly with the standard
 * `page` test fixture.
 */
import { expect, type Page } from '@playwright/test';
import { injectFormFields } from './http';

export interface ProxyHostConfig {
  name: string;
  domain: string;
  upstream: string;        // e.g. "echo-server:8080"
  accessListName?: string; // name of an existing access list to attach
  enableWaf?: boolean;     // enable WAF with OWASP CRS in blocking mode
}

/**
 * Create a proxy host via the browser UI.
 * ssl_forced is always set to false so functional tests can use plain HTTP.
 */
export async function createProxyHost(page: Page, config: ProxyHostConfig): Promise<void> {
  await page.goto('/proxy-hosts');
  await page.getByRole('button', { name: /create host/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByLabel('Name').fill(config.name);
  await page.getByLabel(/domains/i).fill(config.domain);

  // Support multiple upstreams separated by newlines.
  const upstreamList = config.upstream.split('\n').map((u) => u.trim()).filter(Boolean);
  // Fill the first (always-present) upstream input
  await page.getByPlaceholder('10.0.0.5:8080').first().fill(upstreamList[0] ?? '');
  // Add additional upstreams via the "Add Upstream" button
  for (let i = 1; i < upstreamList.length; i++) {
    await page.getByRole('button', { name: /add upstream/i }).click();
    await page.getByPlaceholder('10.0.0.5:8080').nth(i).fill(upstreamList[i]);
  }

  if (config.accessListName) {
    // MUI TextField select — click to open dropdown, then pick the option
    await page.getByRole('combobox', { name: /access list/i }).click();
    await page.getByRole('option', { name: config.accessListName }).click();
  }

  // Inject hidden fields:
  //  ssl_forced_present=on  → tells the action the field was in the form
  //  (ssl_forced absent)    → parseCheckbox(null) = false → no HTTPS redirect
  const extraFields: Record<string, string> = { ssl_forced_present: 'on' };

  if (config.enableWaf) {
    Object.assign(extraFields, {
      waf_present: 'on',
      waf_enabled: 'on',
      waf_engine_mode: 'On',    // blocking mode
      waf_load_owasp_crs: 'on',
      waf_mode: 'override',
    });
  }

  await injectFormFields(page, extraFields);

  await page.getByRole('button', { name: /^create$/i }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(config.name)).toBeVisible({ timeout: 10_000 });
}

export interface AccessListUser {
  username: string;
  password: string;
}

/**
 * Create an access list with initial users via the browser UI.
 * Uses the "Seed members" textarea (username:password per line) so all
 * users are created atomically with the list — no per-user form needed.
 */
export async function createAccessList(
  page: Page,
  name: string,
  users: AccessListUser[]
): Promise<void> {
  await page.goto('/access-lists');

  await page.getByPlaceholder('Internal users').fill(name);

  if (users.length > 0) {
    const seedMembers = users.map((u) => `${u.username}:${u.password}`).join('\n');
    await page.getByLabel('Seed members').fill(seedMembers);
  }

  await page.getByRole('button', { name: /create access list/i }).click();

  // Wait for the card to appear
  await expect(page.getByRole('button', { name: /delete list/i })).toBeVisible({ timeout: 10_000 });
}
