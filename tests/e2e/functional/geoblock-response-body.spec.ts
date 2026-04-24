/**
 * Functional regression test for issue #123.
 *
 * Global geoblocking must keep its custom response body even when a host has a
 * disabled per-host geoblock config in merge mode.
 */
import { test, expect } from '@playwright/test';
import { httpGet, waitForStatus } from '../../helpers/http';

const BASE_URL = 'http://localhost:3000';
const API = `${BASE_URL}/api/v1`;
const DOMAIN = 'func-geoblock-response-body.test';
const CUSTOM_BODY = 'Forbidden anyway!';

const EMPTY_GEOBLOCK = {
  enabled: false,
  block_countries: [], block_continents: [], block_asns: [], block_cidrs: [], block_ips: [],
  allow_countries: [], allow_continents: [], allow_asns: [], allow_cidrs: [], allow_ips: [],
  trusted_proxies: [], fail_closed: false,
  response_status: 403, response_body: 'Forbidden',
  response_headers: {}, redirect_url: '',
};

const DISABLED_HOST_GEOBLOCK = {
  enabled: false,
  block_countries: [],
  block_continents: [],
  block_asns: [],
  block_cidrs: [],
  block_ips: [],
  allow_countries: [],
  allow_continents: [],
  allow_asns: [],
  allow_cidrs: [],
  allow_ips: [],
  trusted_proxies: [],
  fail_closed: false,
  response_status: 403,
  response_body: 'Forbidden',
  response_headers: {},
  redirect_url: '',
};

test.describe.serial('GeoBlock Response Body', () => {
  let proxyHostId: number | null = null;

  test.afterEach(async ({ page }) => {
    if (proxyHostId !== null) {
      const res = await page.request.delete(`${API}/proxy-hosts/${proxyHostId}`, {
        headers: { Origin: BASE_URL },
      });
      expect(res.status()).toBe(200);
      proxyHostId = null;
    }

    const resetRes = await page.request.put(`${API}/settings/geoblock`, {
      data: EMPTY_GEOBLOCK,
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(resetRes.status()).toBe(200);
  });

  test('global custom response body is used when host geoblock is disabled', async ({ page }) => {
    const settingsRes = await page.request.put(`${API}/settings/geoblock`, {
      data: {
        ...EMPTY_GEOBLOCK,
        enabled: true,
        block_cidrs: ['0.0.0.0/0'],
        response_status: 451,
        response_body: CUSTOM_BODY,
      },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(settingsRes.status()).toBe(200);

    const hostRes = await page.request.post(`${API}/proxy-hosts`, {
      data: {
        name: 'Functional GeoBlock Response Body Test',
        domains: [DOMAIN],
        upstreams: ['echo-server:8080'],
        sslForced: false,
        geoblockMode: 'merge',
        geoblock: DISABLED_HOST_GEOBLOCK,
      },
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    });
    expect(hostRes.status()).toBe(201);

    const host = await hostRes.json();
    proxyHostId = host.id;

    await waitForStatus(DOMAIN, 451, 20_000);

    const res = await httpGet(DOMAIN);
    expect(res.status).toBe(451);
    expect(res.body).toBe(CUSTOM_BODY);
  });
});
