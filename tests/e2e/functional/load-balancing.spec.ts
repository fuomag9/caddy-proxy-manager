/**
 * Functional tests: round-robin load balancing across multiple upstreams.
 *
 * Creates a proxy host with two echo servers as upstreams. Each server
 * returns a distinct body so tests can verify that traffic is distributed
 * across both backends.
 *
 * Domain: func-lb.test
 */
import { test, expect } from '@playwright/test';
import { createProxyHost } from '../../helpers/proxy-api';
import { httpGet, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-lb.test';

test.describe.serial('Load Balancing (multiple upstreams)', () => {
  test('setup: create proxy host with two upstreams', async ({ page }) => {
    await createProxyHost(page, {
      name: 'Functional LB Test',
      domain: DOMAIN,
      // Two upstreams separated by newline — both will be round-robined by Caddy.
      // echo-server returns "echo-ok", echo-server-2 returns "echo-server-2".
      upstream: 'echo-server:8080\necho-server-2:8080',
    });
    await waitForRoute(DOMAIN);
  });

  test('all requests return 200', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await httpGet(DOMAIN, '/');
      expect(res.status).toBe(200);
    }
  });

  test('both upstreams are reached over multiple requests', async () => {
    const bodies = new Set<string>();

    // Send enough requests that both backends should be hit via round-robin.
    for (let i = 0; i < 20; i++) {
      const res = await httpGet(DOMAIN, '/');
      if (res.body.includes('echo-ok') || res.body.includes('echo-server-2')) {
        bodies.add(res.body.trim());
      }
    }

    // Both distinct responses must appear
    expect(bodies.size).toBeGreaterThanOrEqual(2);
    const arr = Array.from(bodies);
    expect(arr.some((b) => b.includes('echo-ok'))).toBe(true);
    expect(arr.some((b) => b.includes('echo-server-2'))).toBe(true);
  });

  test('different paths all return 200', async () => {
    const paths = ['/', '/api/test', '/some/deep/path', '/health'];
    for (const path of paths) {
      const res = await httpGet(DOMAIN, path);
      expect(res.status).toBe(200);
    }
  });
});
