/**
 * Functional tests: WAF (Web Application Firewall) blocking.
 *
 * Creates a proxy host with per-host WAF enabled (OWASP CRS, blocking mode)
 * and verifies Caddy/Coraza blocks known attack payloads while passing
 * legitimate traffic through to the echo server.
 *
 * Domain: func-waf.test
 */
import { test, expect } from '@playwright/test';
import { createProxyHost } from '../../helpers/proxy-api';
import { httpGet, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-waf.test';
const ECHO_BODY = 'echo-ok';

test.describe.serial('WAF Blocking', () => {
  test('setup: create proxy host with WAF + OWASP CRS enabled', async ({ page }) => {
    await createProxyHost(page, {
      name: 'Functional WAF Test',
      domain: DOMAIN,
      upstream: 'echo-server:8080',
      enableWaf: true,
    });
    await waitForRoute(DOMAIN);
  });

  test('legitimate request passes through WAF', async () => {
    const res = await httpGet(DOMAIN, '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('legitimate query string passes through WAF', async () => {
    const res = await httpGet(DOMAIN, '/search?q=hello+world&page=2');
    expect(res.status).toBe(200);
    expect(res.body).toContain(ECHO_BODY);
  });

  test('SQL injection UNION SELECT is blocked (CRS rule 942xxx)', async () => {
    // URL-encoded: ?id=1' UNION SELECT 1,2,3--
    const res = await httpGet(DOMAIN, "/search?id=1'%20UNION%20SELECT%201%2C2%2C3--");
    expect(res.status).toBe(403);
  });

  test("SQL injection OR '1'='1 is blocked", async () => {
    // URL-encoded: ?id=1' OR '1'='1
    const res = await httpGet(DOMAIN, "/item?id=1'%20OR%20'1'%3D'1");
    expect(res.status).toBe(403);
  });

  test('XSS <script> tag is blocked (CRS rule 941xxx)', async () => {
    // URL-encoded: ?q=<script>alert(1)</script>
    const res = await httpGet(DOMAIN, '/page?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(res.status).toBe(403);
  });

  test('XSS javascript: URI is blocked', async () => {
    // URL-encoded: ?url=javascript:alert(document.cookie)
    const res = await httpGet(DOMAIN, '/redir?url=javascript%3Aalert(document.cookie)');
    expect(res.status).toBe(403);
  });

  test('path traversal ../../etc/passwd is blocked (CRS rule 930xxx)', async () => {
    const res = await httpGet(DOMAIN, '/files/..%2F..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(403);
  });
});
