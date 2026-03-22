/**
 * Functional tests: basic reverse-proxy routing.
 *
 * Creates a real proxy host pointing at the echo-server container,
 * then sends HTTP requests directly to Caddy and asserts the response
 * comes from the upstream.
 *
 * Domain: func-proxy.test  (no DNS resolution needed — requests go to
 * 127.0.0.1:80 with a custom Host header, which Caddy routes by hostname).
 */
import { test, expect } from '@playwright/test';
import { createProxyHost } from '../../helpers/proxy-api';
import { httpGet, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-proxy.test';
const ECHO_BODY = 'echo-ok';

test.describe.serial('Proxy Routing', () => {
  test('setup: create proxy host pointing at echo server', async ({ page }) => {
    await createProxyHost(page, {
      name: 'Functional Proxy Test',
      domain: DOMAIN,
      upstream: 'echo-server:8080',
    });
    await waitForRoute(DOMAIN);
  });

  test('routes HTTP requests to the upstream echo server', async () => {
    const res = await httpGet(DOMAIN);
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('proxies arbitrary paths to the upstream', async () => {
    const res = await httpGet(DOMAIN, '/some/path?q=hello');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('unknown domain is not proxied to the echo server', async () => {
    // Caddy may return 404 or redirect (308 HTTP→HTTPS) for unmatched routes —
    // either way the request must not reach the echo upstream.
    const res = await httpGet('no-such-route.test');
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain(ECHO_BODY);
  });

  test('disabled proxy host stops routing traffic', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const row = page.locator('tr', { hasText: 'Functional Proxy Test' });
    // Toggle the enabled switch (shadcn Switch renders as button with role="switch")
    await row.getByRole('switch').click();
    // Give Caddy time to reload config
    await page.waitForTimeout(3_000);

    const res = await httpGet(DOMAIN);
    // Disabled host is removed from the route; Caddy may return 404 or
    // redirect (308 HTTP→HTTPS) — either way the echo server is not reached.
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain(ECHO_BODY);

    // Re-enable
    await row.getByRole('switch').click();
    await page.waitForTimeout(2_000);
  });
});
