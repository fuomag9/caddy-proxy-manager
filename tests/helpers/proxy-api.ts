/**
 * Higher-level helpers for creating proxy hosts and access lists
 * in functional E2E tests.
 *
 * All helpers accept a Playwright `Page` (pre-authenticated via the
 * global storageState) so they integrate cleanly with the standard
 * `page` test fixture.
 */
import { expect, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { injectFormFields } from './http';

export interface ProxyHostConfig {
  name: string;
  domain: string;
  upstream: string;        // e.g. "echo-server:8080"
  accessListName?: string; // name of an existing access list to attach
  certificateName?: string;
  mtlsCaNames?: string[];
  enableWaf?: boolean;     // enable WAF with OWASP CRS in blocking mode
}

export interface ImportedCertificateConfig {
  name: string;
  domains: string[];
  certificatePem: string;
  privateKeyPem: string;
}

export interface GeneratedCaConfig {
  name: string;
  commonName?: string;
  validityDays?: number;
}

export interface IssuedClientCertificateConfig {
  caName: string;
  commonName: string;
  exportPassword: string;
  validityDays?: number;
  compatibilityMode?: boolean;
}

async function openCertificatesTab(page: Page, tabName: RegExp): Promise<void> {
  await page.goto('/certificates');
  await page.getByRole('tab', { name: tabName }).click();
}

async function expandCaRow(page: Page, caName: string): Promise<void> {
  const row = page.locator('tr').filter({ hasText: caName }).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.locator('button').first().click();
  await expect(page.getByText(/issued client certificates/i)).toBeVisible({ timeout: 10_000 });
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

  if (config.certificateName) {
    await page.getByRole('combobox', { name: /certificate/i }).click();
    await page.getByRole('option', { name: config.certificateName, exact: true }).click();
  }

  if (config.accessListName) {
    // MUI TextField select — click to open dropdown, then pick the option
    await page.getByRole('combobox', { name: /access list/i }).click();
    await page.getByRole('option', { name: config.accessListName }).click();
  }

  if (config.mtlsCaNames?.length) {
    await page.evaluate(() => {
      const form = document.getElementById('create-host-form');
      const mtlsHidden = form?.querySelector<HTMLInputElement>('input[name="mtls_enabled"]');
      const section = mtlsHidden?.parentElement;
      const switchInput = section?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!form || !mtlsHidden || !section || !switchInput) {
        throw new Error('mTLS section not found in create host dialog');
      }
      switchInput.click();
    });

    await expect(page.getByText(/trusted client ca certificates/i)).toBeVisible({ timeout: 10_000 });
    await page.evaluate((caNames: string[]) => {
      const form = document.getElementById('create-host-form');
      const mtlsHidden = form?.querySelector<HTMLInputElement>('input[name="mtls_enabled"]');
      const section = mtlsHidden?.parentElement;
      if (!form || !mtlsHidden || !section) {
        throw new Error('mTLS section not found in create host dialog');
      }

      for (const caName of caNames) {
        const label = Array.from(section.querySelectorAll('label')).find((el) =>
          el.textContent?.includes(caName)
        );
        const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!label || !input) {
          throw new Error(`mTLS CA checkbox not found for "${caName}"`);
        }
        if (!input.checked) {
          input.click();
        }
      }
    }, config.mtlsCaNames);
    await expect(page.locator('input[name="mtls_ca_cert_id"]')).toHaveCount(config.mtlsCaNames.length);
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
  await expect(page.getByRole('table').getByText(config.name)).toBeVisible({ timeout: 10_000 });
}

export async function importCertificate(page: Page, config: ImportedCertificateConfig): Promise<void> {
  await openCertificatesTab(page, /^Imported/i);
  await page.getByRole('button', { name: /import certificate/i }).click();
  await expect(page.getByRole('heading', { name: /^import certificate$/i })).toBeVisible();

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(config.name);
  await page.getByLabel(/domains \(one per line\)/i).fill(config.domains.join('\n'));
  await page.locator('[name="certificate_pem"]').fill(config.certificatePem);
  await page.getByRole('button', { name: /show private key/i }).click();
  await page.locator('[name="private_key_pem"]').fill(config.privateKeyPem);
  await page.getByRole('button', { name: /^import certificate$/i }).click();

  await expect(page.getByText(config.name).first()).toBeVisible({ timeout: 10_000 });
}

export async function generateCaCertificate(page: Page, config: GeneratedCaConfig): Promise<void> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await page.getByRole('button', { name: /add ca certificate/i }).click();
  await expect(page.getByRole('heading', { name: /^add ca certificate$/i })).toBeVisible();

  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(config.name);
  if (config.commonName) {
    await page.getByRole('textbox', { name: 'Common Name (CN)', exact: true }).fill(config.commonName);
  }
  if (config.validityDays !== undefined) {
    await page.getByRole('spinbutton', { name: 'Validity', exact: true }).fill(String(config.validityDays));
  }

  await page.getByRole('button', { name: /generate ca certificate/i }).click();
  await expect(page.getByText(config.name)).toBeVisible({ timeout: 15_000 });
}

export async function issueClientCertificate(
  page: Page,
  config: IssuedClientCertificateConfig
): Promise<Buffer> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await expandCaRow(page, config.caName);
  await page.getByRole('button', { name: /^issue cert$/i }).click();
  await expect(page.getByRole('dialog', { name: /issue client certificate/i })).toBeVisible();

  await page.getByRole('textbox', { name: 'Common Name (CN)', exact: true }).fill(config.commonName);
  if (config.validityDays !== undefined) {
    await page.getByRole('spinbutton', { name: 'Validity', exact: true }).fill(String(config.validityDays));
  }
  await page.getByLabel(/export password/i).fill(config.exportPassword);

  const shouldBeChecked = config.compatibilityMode ?? true;
  if (!shouldBeChecked) {
    const compatibilityToggle = page.locator('input[name="compatibility_mode"]').first();
    await compatibilityToggle.click({ force: true });
  }

  await page.getByRole('button', { name: /issue certificate/i }).click();
  await expect(page.getByRole('button', { name: /download client certificate/i })).toBeVisible({ timeout: 15_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /download client certificate/i }).click();
  const download = await downloadPromise;
  const downloadPath = await saveDownload(download);

  await page.getByRole('button', { name: /^done$/i }).click();
  await expect(page.getByRole('dialog', { name: /issue client certificate/i })).not.toBeVisible({ timeout: 10_000 });

  return readFile(downloadPath);
}

export async function revokeIssuedClientCertificate(page: Page, caName: string, commonName: string): Promise<void> {
  await openCertificatesTab(page, /^CA \/ mTLS/i);
  await expandCaRow(page, caName);
  await page.getByRole('button', { name: /^manage$/i }).click();
  const dialog = page.getByRole('dialog', { name: /issued client certificates/i });
  await expect(dialog).toBeVisible();

  const card = dialog
    .getByRole('heading', { name: commonName, exact: true })
    .locator('xpath=ancestor::div[.//button[normalize-space()="Revoke"]][1]');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: /^revoke$/i }).click();
  await expect(dialog.getByRole('heading', { name: commonName, exact: true })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole('button', { name: /^close$/i }).click();
}

async function saveDownload(download: Download): Promise<string> {
  const downloadPath = await download.path();
  if (!downloadPath) {
    throw new Error('Playwright download did not produce a local file path');
  }
  return downloadPath;
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
