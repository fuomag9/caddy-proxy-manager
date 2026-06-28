/**
 * E2E: wildcard proxy host requires a DNS provider.
 *
 * Wildcard certs (*.example.com) can only be issued via the ACME DNS-01
 * challenge. An auto-managed wildcard host (no certificate assigned) is
 * rejected at the API when no DNS provider is configured, and accepted once
 * one is. Exact-domain hosts are never affected.
 */
import { test, expect } from '@playwright/test';

const API_PROXY_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';
const API_DNS_PROVIDER = 'http://localhost:3000/api/v1/settings/dns-provider';

test.describe('Wildcard host DNS-provider guard', () => {
  test('rejects auto-managed wildcard without a DNS provider, allows it once configured', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const origin = new URL(page.url()).origin;
    const headers = { Origin: origin };

    // Preserve whatever DNS-provider config the stack already has.
    const originalResp = await page.request.get(API_DNS_PROVIDER);
    expect(originalResp.ok()).toBeTruthy();
    const original = await originalResp.json();

    const createdIds: number[] = [];
    try {
      // ── No DNS provider configured ──────────────────────────────────────
      const clearResp = await page.request.put(API_DNS_PROVIDER, {
        headers,
        data: { providers: {}, default: null },
      });
      expect(clearResp.ok()).toBeTruthy();

      const rejected = await page.request.post(API_PROXY_HOSTS, {
        headers,
        data: { name: 'Wildcard Guard', domains: ['*.e2e-wildcard.test'], upstreams: ['localhost:9999'] },
      });
      expect(rejected.ok()).toBeFalsy();
      expect((await rejected.json()).error).toMatch(/DNS provider/i);

      // Control: an exact-domain host is unaffected by the guard.
      const okExact = await page.request.post(API_PROXY_HOSTS, {
        headers,
        data: { name: 'Exact Guard', domains: ['exact.e2e-wildcard.test'], upstreams: ['localhost:9999'] },
      });
      expect(okExact.ok()).toBeTruthy();
      createdIds.push((await okExact.json()).id);

      // ── DNS provider configured ─────────────────────────────────────────
      const setResp = await page.request.put(API_DNS_PROVIDER, {
        headers,
        data: { providers: { duckdns: { api_token: 'e2e-fake-token' } }, default: 'duckdns' },
      });
      expect(setResp.ok()).toBeTruthy();

      const allowed = await page.request.post(API_PROXY_HOSTS, {
        headers,
        data: { name: 'Wildcard Allowed', domains: ['*.e2e-wildcard.test'], upstreams: ['localhost:9999'] },
      });
      expect(allowed.ok()).toBeTruthy();
      createdIds.push((await allowed.json()).id);
    } finally {
      for (const id of createdIds) {
        await page.request.delete(`${API_PROXY_HOSTS}/${id}`, { headers });
      }
      await page.request.put(API_DNS_PROVIDER, {
        headers,
        data: original && Object.keys(original).length ? original : { providers: {}, default: null },
      });
    }
  });
});
