/**
 * E2E: per-location-rule load balancer / health checks (issue #200).
 *
 * Creates a proxy host whose location rule carries a load balancer with active
 * and passive health checks via the REST API. A 201 response proves the live
 * Caddy accepted the generated per-rule load_balancing/health_checks JSON; the
 * read-back proves the model hydrated the nested config.
 */
import { test, expect } from '@playwright/test';

const API_PROXY_HOSTS = 'http://localhost:3000/api/v1/proxy-hosts';

test.describe('Location rule load balancer', () => {
  test('creates and reads back a location rule with load balancer + health checks', async ({ page }) => {
    await page.goto('/proxy-hosts');
    const origin = new URL(page.url()).origin;
    const headers = { Origin: origin };

    const payload = {
      name: 'Location LB Host',
      domains: ['loclb.example.test'],
      upstreams: ['origin:80'],
      locationRules: [
        {
          path: '/api/*',
          upstreams: ['api-a:8080', 'api-b:8080'],
          loadBalancer: {
            enabled: true,
            policy: 'round_robin',
            tryDuration: '5s',
            retries: 3,
            activeHealthCheck: { enabled: true, uri: '/health', port: 8081, interval: '30s', timeout: '5s', status: 200 },
            passiveHealthCheck: { enabled: true, failDuration: '30s', maxFails: 5, unhealthyStatus: [500, 502, 503] },
          },
        },
      ],
    };

    let createdId: number | undefined;
    try {
      const createResp = await page.request.post(API_PROXY_HOSTS, { headers, data: payload });
      expect(createResp.ok()).toBeTruthy();
      const created = await createResp.json();
      createdId = created.id;

      const getResp = await page.request.get(`${API_PROXY_HOSTS}/${created.id}`);
      expect(getResp.ok()).toBeTruthy();
      const host = await getResp.json();

      const rule = host.locationRules[0];
      expect(rule.path).toBe('/api/*');
      expect(rule.upstreams).toEqual(['api-a:8080', 'api-b:8080']);
      expect(rule.loadBalancer).toMatchObject({
        enabled: true,
        policy: 'round_robin',
        retries: 3,
        activeHealthCheck: { enabled: true, uri: '/health', port: 8081, status: 200 },
        passiveHealthCheck: { enabled: true, maxFails: 5, unhealthyStatus: [500, 502, 503] },
      });
    } finally {
      if (createdId) {
        await page.request.delete(`${API_PROXY_HOSTS}/${createdId}`, { headers });
      }
    }
  });
});
