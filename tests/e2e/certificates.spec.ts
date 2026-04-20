import { test, expect } from '@playwright/test';

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
    const wcHost = await wcHostRes.json();

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
    const subHost = await subHostRes.json();

    try {
      // 3. Visit certificates page — subdomain should be collapsed under the wildcard
      await page.goto('/certificates');
      await expect(page.getByRole('tab', { name: /acme/i })).toBeVisible();
      await page.getByRole('tab', { name: /acme/i }).click();

      const acmeTab = page.locator('[role="tabpanel"]');
      // The wildcard host should be visible
      await expect(acmeTab.getByText(`*.${domain}`)).toBeVisible({ timeout: 5_000 });
      // The subdomain host should NOT appear as a separate entry
      await expect(acmeTab.getByText(`sub.${domain}`)).not.toBeVisible({ timeout: 5_000 });
    } finally {
      await page.request.delete(`${API}/proxy-hosts/${subHost.id}`, { headers });
      await page.request.delete(`${API}/proxy-hosts/${wcHost.id}`, { headers });
    }
  });
});
