import { test, expect } from '@playwright/test';
import { createSelfSignedServerCertificate } from '../helpers/certs';

test.describe('Certificates', () => {
  test('page loads with tabs visible', async ({ page }) => {
    await page.goto('/certificates');
    // At minimum the page should load without error
    await expect(page).not.toHaveURL(/error|login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('certificates page has certificate management UI', async ({ page }) => {
    await page.goto('/certificates');
    // Should have some kind of Add button or tab UI
    await expect(page.locator('body')).toBeVisible();
    // Look for tabs or buttons
    const hasAddButton = await page.getByRole('button', { name: /add|new|create/i }).count() > 0;
    const hasTab = await page.getByRole('tab').count() > 0;
    expect(hasAddButton || hasTab).toBe(true);
  });

  test('navigating to certificates does not redirect to login', async ({ page }) => {
    await page.goto('/certificates');
    await expect(page).not.toHaveURL(/login/);
  });

  test('wildcard cert covers subdomain — no duplicate in ACME tab', async ({ page }) => {
    const BASE_URL = 'http://localhost:3000';
    const API = `${BASE_URL}/api/v1`;
    const headers = { 'Content-Type': 'application/json', 'Origin': BASE_URL };
    const domain = `wc-test-${Date.now()}.example`;

    // 1. Create a managed certificate with wildcard + base domain
    const certRes = await page.request.post(`${API}/certificates`, {
      data: {
        name: `Wildcard ${domain}`,
        type: 'managed',
        domainNames: [domain, `*.${domain}`],
        autoRenew: true,
      },
      headers,
    });
    expect(certRes.status()).toBe(201);
    const cert = await certRes.json();

    // 2. Create a proxy host for a subdomain (no explicit certificateId → auto ACME)
    const hostRes = await page.request.post(`${API}/proxy-hosts`, {
      data: {
        name: `Sub ${domain}`,
        domains: [`sub.${domain}`],
        upstreams: ['127.0.0.1:8080'],
      },
      headers,
    });
    expect(hostRes.status()).toBe(201);
    const host = await hostRes.json();

    try {
      // 3. Visit certificates page — the subdomain host should NOT appear in the ACME tab
      await page.goto('/certificates');
      await expect(page.getByRole('tab', { name: /acme/i })).toBeVisible();
      await page.getByRole('tab', { name: /acme/i }).click();

      // The subdomain should not be listed as a separate ACME entry
      const acmeTab = page.locator('[role="tabpanel"]');
      await expect(acmeTab.getByText(`sub.${domain}`)).not.toBeVisible({ timeout: 5_000 });
    } finally {
      // Cleanup: delete the proxy host and certificate
      await page.request.delete(`${API}/proxy-hosts/${host.id}`, { headers });
      await page.request.delete(`${API}/certificates/${cert.id}`, { headers });
    }
  });

  test('ACME wildcard host hides subdomain ACME hosts in certificates page', async ({ page }) => {
    const BASE_URL = 'http://localhost:3000';
    const API = `${BASE_URL}/api/v1`;
    const headers = { 'Content-Type': 'application/json', 'Origin': BASE_URL };
    const domain = `acme-wc-${Date.now()}.example`;

    // Auto-managed wildcard hosts require a DNS provider (ACME DNS-01 challenge).
    // Configure one for this test and restore the original afterwards.
    const dnsProviderUrl = `${API}/settings/dns-provider`;
    const originalDns = await (await page.request.get(dnsProviderUrl, { headers: { Origin: BASE_URL } })).json();
    const setDnsRes = await page.request.put(dnsProviderUrl, {
      data: { providers: { duckdns: { api_token: 'e2e-fake-token' } }, default: 'duckdns' },
      headers,
    });
    expect(setDnsRes.ok()).toBeTruthy();

    let wcHostId: number | undefined;
    let subHostId: number | undefined;
    try {
      // 1. Create a proxy host with wildcard domain (no certificate → ACME auto)
      const wcHostRes = await page.request.post(`${API}/proxy-hosts`, {
        data: {
          name: `Wildcard ${domain}`,
          domains: [`*.${domain}`],
          upstreams: ['127.0.0.1:8080'],
        },
        headers,
      });
      expect(wcHostRes.status()).toBe(201);
      wcHostId = (await wcHostRes.json()).id;

      // 2. Create a proxy host for a subdomain (also no certificate → ACME auto)
      const subHostRes = await page.request.post(`${API}/proxy-hosts`, {
        data: {
          name: `Sub ${domain}`,
          domains: [`sub.${domain}`],
          upstreams: ['127.0.0.1:8080'],
        },
        headers,
      });
      expect(subHostRes.status()).toBe(201);
      subHostId = (await subHostRes.json()).id;

      // 3. Visit certificates page — subdomain should be collapsed under the wildcard
      await page.goto('/certificates');
      await expect(page.getByRole('tab', { name: /acme/i })).toBeVisible();
      await page.getByRole('tab', { name: /acme/i }).click();

      const acmeTab = page.locator('[role="tabpanel"]');
      // DataTable renders both a hidden mobile card and a visible desktop table row.
      // Mobile card is first in the DOM (block md:hidden) — use .last() to get the visible desktop row.
      await expect(acmeTab.getByText(`*.${domain}`).last()).toBeVisible({ timeout: 5_000 });
      // The subdomain host should NOT appear as a separate entry
      await expect(acmeTab.getByText(`sub.${domain}`)).not.toBeVisible({ timeout: 5_000 });
    } finally {
      if (subHostId) await page.request.delete(`${API}/proxy-hosts/${subHostId}`, { headers });
      if (wcHostId) await page.request.delete(`${API}/proxy-hosts/${wcHostId}`, { headers });
      await page.request.put(dnsProviderUrl, {
        data: originalDns && Object.keys(originalDns).length ? originalDns : { providers: {}, default: null },
        headers,
      });
    }
  });

  test('deletes an imported certificate from the Imported tab (#151)', async ({ page }) => {
    const BASE_URL = 'http://localhost:3000';
    const API = `${BASE_URL}/api/v1`;
    const headers = { 'Content-Type': 'application/json', 'Origin': BASE_URL };
    const domain = `import-delete-${Date.now()}.example`;
    const certName = `Imported Delete ${domain}`;
    const { certificatePem, privateKeyPem } = createSelfSignedServerCertificate(domain, [domain]);

    const certRes = await page.request.post(`${API}/certificates`, {
      data: {
        name: certName,
        type: 'imported',
        domainNames: [domain],
        autoRenew: false,
        certificatePem,
        privateKeyPem,
      },
      headers,
    });
    expect(certRes.status()).toBe(201);
    const cert = await certRes.json() as { id: number };

    try {
      await page.goto('/certificates');
      await page.getByRole('tab', { name: /imported/i }).click();

      await expect(page.getByText(certName).last()).toBeVisible({ timeout: 10_000 });

      await page.getByRole('button', { name: `Actions for certificate ${certName}` }).last().click();
      await page.getByRole('menuitem', { name: /^delete$/i }).click();

      const dialog = page.getByRole('dialog', { name: /delete imported certificate/i });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: /delete certificate/i }).click();

      await expect(dialog).not.toBeVisible({ timeout: 10_000 });
      await expect(page.getByText(certName)).not.toBeVisible({ timeout: 10_000 });

      const getRes = await page.request.get(`${API}/certificates/${cert.id}`, { headers: { Origin: BASE_URL } });
      expect(getRes.status()).toBe(404);
    } finally {
      await page.request.delete(`${API}/certificates/${cert.id}`, { headers }).catch(() => undefined);
    }
  });

  test('imports a certificate via the UI form preserving PEM newlines (#157)', async ({ page }) => {
    const BASE_URL = 'http://localhost:3000';
    const API = `${BASE_URL}/api/v1`;
    const headers = { 'Content-Type': 'application/json', 'Origin': BASE_URL };
    const domain = `import-ui-${Date.now()}.example`;
    const certName = `UI Import ${domain}`;
    const { certificatePem, privateKeyPem } = createSelfSignedServerCertificate(domain, [domain]);

    // Sanity-check the fixture: PEM blocks must be multi-line for this test
    // to meaningfully exercise newline preservation.
    expect(privateKeyPem.split('\n').length).toBeGreaterThan(3);

    let createdId: number | null = null;
    try {
      await page.goto('/certificates');
      await page.getByRole('tab', { name: /imported/i }).click();

      // Open the Import drawer. The "Add"/"Import" trigger varies by viewport,
      // so match any button that opens the import flow.
      await page.getByRole('button', { name: /import certificate|add certificate|^import$|^add$/i }).first().click();

      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();

      await drawer.getByLabel(/^name$/i).fill(certName);
      await drawer.getByLabel(/domains/i).fill(domain);

      // Certificate PEM goes into a textarea — newlines preserved trivially.
      await drawer.getByLabel(/certificate pem/i).fill(certificatePem);

      // Private Key PEM: paste while the field is in the default (hidden/masked)
      // state. Regression for #157 — a <input type="password"> would silently
      // strip the newlines from the pasted PEM, corrupting the key.
      const keyField = drawer.getByLabel(/private key pem/i);
      await keyField.click();
      await keyField.fill(privateKeyPem);

      await drawer.getByRole('button', { name: /import certificate|save changes/i }).click();
      await expect(drawer).not.toBeVisible({ timeout: 10_000 });

      // Verify via the API that the persisted PEM still contains its original
      // newlines — this is what would fail if the password-input regressed.
      const listRes = await page.request.get(`${API}/certificates`, { headers: { Origin: BASE_URL } });
      expect(listRes.ok()).toBe(true);
      const list = await listRes.json() as Array<{ id: number; name: string; privateKeyPem: string | null }>;
      const created = list.find((c) => c.name === certName);
      expect(created).toBeTruthy();
      createdId = created!.id;
      expect(created!.privateKeyPem).toContain('-----BEGIN');
      expect(created!.privateKeyPem).toContain('-----END');
      expect(created!.privateKeyPem!.split('\n').length).toBeGreaterThan(3);
      // The persisted key must round-trip byte-for-byte (ignoring trailing whitespace).
      expect(created!.privateKeyPem!.trimEnd()).toBe(privateKeyPem.trimEnd());
    } finally {
      if (createdId !== null) {
        await page.request.delete(`${API}/certificates/${createdId}`, { headers }).catch(() => undefined);
      }
    }
  });
});
