/**
 * Functional tests: custom error pages (Caddy handle_errors).
 *
 * These exercise the real error path that the "Custom Reverse Proxy (JSON)" /
 * "Custom Pre-Handlers (JSON)" fields could NOT reach (issue #168): a server-level
 * error route that fires when a handler raises an error — most importantly a
 * reverse_proxy dial failure when the upstream is down (502).
 *
 * Hosts are pointed at `whoami-server:9999` — the whoami container resolves, but
 * nothing listens on :9999, so every request fails to dial and Caddy raises a 502,
 * which is what triggers the error route. A healthy host (whoami-server:80) is used
 * to prove error pages don't touch successful responses.
 *
 * Coverage:
 *   - Per-host page served on a down upstream, with the original status preserved.
 *   - Default and custom Content-Type.
 *   - Status matching: a [502] rule fires on a 502, a [404] rule does not.
 *   - Empty status list = catch-all (matches any error).
 *   - Healthy upstream is unaffected.
 *   - Global page as a fallback when a host defines none.
 *   - Per-host page takes precedence over the global one.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { httpGet, waitForRoute, waitForBody } from '../../helpers/http';

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const DEAD_UPSTREAM = 'whoami-server:9999';   // resolves, refuses → reverse_proxy 502
const HEALTHY_UPSTREAM = 'whoami-server:80';

type ErrorPageRule = { statuses: number[]; body: string; contentType?: string };

async function createHost(
  page: Page,
  name: string,
  domain: string,
  upstream: string,
  errorPages?: ErrorPageRule[],
): Promise<number> {
  const res = await page.request.post(`${API}/proxy-hosts`, {
    data: {
      name,
      domains: [domain],
      upstreams: [upstream],
      sslForced: false,
      ...(errorPages ? { errorPages } : {}),
    },
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as number;
}

async function deleteHosts(page: Page, ids: number[]): Promise<void> {
  for (const id of ids) {
    const res = await page.request.delete(`${API}/proxy-hosts/${id}`, {
      headers: { Origin: BASE_URL },
    });
    expect(res.status()).toBe(200);
  }
}

async function setGlobalErrorPages(page: Page, rules: ErrorPageRule[]): Promise<void> {
  const res = await page.request.put(`${API}/settings/error-pages`, {
    data: { rules },
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
  });
  expect(res.status()).toBe(200);
}

test.describe.serial('Custom error pages — per host', () => {
  const hostIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    // Ensure no global error pages bleed in from another spec or block.
    const page = await browser.newPage();
    await setGlobalErrorPages(page, []);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await deleteHosts(page, hostIds);
    await page.close();
  });

  test('serves a custom page (default text/html) when the upstream is down', async ({ page }) => {
    const domain = 'func-err-basic.test';
    hostIds.push(await createHost(page, 'Error Pages — basic 502', domain, DEAD_UPSTREAM, [
      { statuses: [502, 503, 504], body: '<h1>Maintenance — be right back</h1>' },
    ]));

    await waitForBody(domain, 'Maintenance — be right back');

    const res = await httpGet(domain);
    // The original error status code must be preserved, not replaced with 200.
    expect(res.status).toBe(502);
    expect(res.body).toContain('<h1>Maintenance — be right back</h1>');
    // No contentType configured → defaults to text/html.
    expect(String(res.headers['content-type'])).toContain('text/html');
  });

  test('selects the rule matching the actual status and skips non-matching rules', async ({ page }) => {
    const domain = 'func-err-select.test';
    // First rule targets 404 (must NOT fire on a 502), second targets 502 (must fire).
    hostIds.push(await createHost(page, 'Error Pages — status select', domain, DEAD_UPSTREAM, [
      { statuses: [404], body: 'PAGE_FOR_404' },
      { statuses: [502], body: 'PAGE_FOR_502' },
    ]));

    await waitForBody(domain, 'PAGE_FOR_502');

    const res = await httpGet(domain);
    expect(res.status).toBe(502);
    expect(res.body).toContain('PAGE_FOR_502');
    expect(res.body).not.toContain('PAGE_FOR_404');
  });

  test('an empty status list matches any error (catch-all) and honors a custom Content-Type', async ({ page }) => {
    const domain = 'func-err-catchall.test';
    hostIds.push(await createHost(page, 'Error Pages — catch-all', domain, DEAD_UPSTREAM, [
      { statuses: [], body: 'CATCH_ALL_ERROR', contentType: 'text/plain; charset=utf-8' },
    ]));

    await waitForBody(domain, 'CATCH_ALL_ERROR');

    const res = await httpGet(domain);
    expect(res.status).toBe(502);
    expect(res.body).toContain('CATCH_ALL_ERROR');
    expect(String(res.headers['content-type'])).toBe('text/plain; charset=utf-8');
  });

  test('does not interfere with a healthy upstream', async ({ page }) => {
    const domain = 'func-err-healthy.test';
    hostIds.push(await createHost(page, 'Error Pages — healthy', domain, HEALTHY_UPSTREAM, [
      { statuses: [], body: 'SHOULD_NOT_APPEAR' },
    ]));

    await waitForRoute(domain);

    const res = await httpGet(domain);
    expect(res.status).toBe(200);
    // whoami echoes request info on success; the error body must never appear.
    expect(res.body).toContain('Hostname');
    expect(res.body).not.toContain('SHOULD_NOT_APPEAR');
  });
});

test.describe.serial('Custom error pages — global + precedence', () => {
  const hostIds: number[] = [];

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await setGlobalErrorPages(page, [{ statuses: [], body: 'GLOBAL_ERROR_PAGE' }]);
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await deleteHosts(page, hostIds);
    await setGlobalErrorPages(page, []); // reset so other specs aren't affected
    await page.close();
  });

  test('falls back to the global error page when a host defines none', async ({ page }) => {
    const domain = 'func-err-global.test';
    hostIds.push(await createHost(page, 'Error Pages — global fallback', domain, DEAD_UPSTREAM));

    await waitForBody(domain, 'GLOBAL_ERROR_PAGE');

    const res = await httpGet(domain);
    expect(res.status).toBe(502);
    expect(res.body).toContain('GLOBAL_ERROR_PAGE');
  });

  test('per-host error page takes precedence over the global one', async ({ page }) => {
    const domain = 'func-err-override.test';
    hostIds.push(await createHost(page, 'Error Pages — per-host override', domain, DEAD_UPSTREAM, [
      { statuses: [], body: 'HOST_OVERRIDE_PAGE' },
    ]));

    await waitForBody(domain, 'HOST_OVERRIDE_PAGE');

    const res = await httpGet(domain);
    expect(res.status).toBe(502);
    expect(res.body).toContain('HOST_OVERRIDE_PAGE');
    expect(res.body).not.toContain('GLOBAL_ERROR_PAGE');
  });
});
