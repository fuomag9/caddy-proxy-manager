/**
 * Functional tests: structured Path Blocks and Path Rewrites.
 *
 * Creates a proxy host with:
 *   - a Path Block for /dns-query → 403 "Forbidden"
 *   - a Path Rewrite for /secretpath → /dns-query
 *   - default routing to whoami-server (which echoes the request line)
 *
 * Verifies that:
 *   - Blocked paths return the configured status + body (no proxying).
 *   - Rewrites change the URI seen by the upstream.
 *   - A rewrite to a path that is ALSO blocked does NOT re-match the block
 *     (subroute routes are evaluated sequentially), so the upstream still
 *     sees the rewritten path.
 *   - Unmatched paths are proxied normally.
 *
 * The pathBlocksJson / pathRewritesJson hidden fields are injected directly
 * (same pattern as redirects.spec.ts) so the test doesn't have to drive the
 * dynamic dialog rows.
 *
 * Domain: func-path-rules.test
 */
import { test, expect } from '@playwright/test';
import { httpGet, injectFormFields, waitForRoute } from '../../helpers/http';

const DOMAIN = 'func-path-rules.test';

test.describe.serial('Path Blocks and Path Rewrites', () => {
  test('setup: create proxy host with path blocks and rewrites', async ({ page }) => {
    await page.goto('/proxy-hosts');
    await page.getByRole('button', { name: /create host/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel('Name').fill('Functional Path Blocks/Rewrites Test');
    await page.getByLabel(/domains/i).fill(DOMAIN);
    // whoami-server echoes the full request line, letting us assert the
    // rewritten URI is what the upstream received.
    await page.getByPlaceholder('10.0.0.5:8080').first().fill('whoami-server:80');

    await injectFormFields(page, {
      sslForcedPresent: 'on',
      pathBlocksJson: JSON.stringify([
        { path: '/dns-query', status: 403, body: 'Forbidden' },
        { path: '/admin/*',   status: 404 },
      ]),
      pathRewritesJson: JSON.stringify([
        { from: '/secretpath', to: '/dns-query' },
        { from: '/oldapi',     to: '/v2/api' },
      ]),
    });

    await page.getByRole('button', { name: /^create$/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('table').getByText('Functional Path Blocks/Rewrites Test')).toBeVisible({ timeout: 10_000 });

    await waitForRoute(DOMAIN);
  });

  test('blocked exact path returns the configured status and body', async () => {
    const res = await httpGet(DOMAIN, '/dns-query');
    expect(res.status).toBe(403);
    expect(res.body).toBe('Forbidden');
  });

  test('blocked path is terminal — request never reaches the upstream', async () => {
    const res = await httpGet(DOMAIN, '/dns-query');
    // whoami-server echoes "GET /dns-query HTTP/..." when proxied. The block
    // returns a static_response, so that echo must NOT appear in the body.
    expect(res.body).not.toMatch(/GET \/dns-query HTTP/);
  });

  test('wildcard block matches subpaths with the configured status', async () => {
    const res = await httpGet(DOMAIN, '/admin/users');
    expect(res.status).toBe(404);
  });

  test('rewrite changes the URI seen by the upstream', async () => {
    // The upstream is whoami-server, which echoes the request line. After the
    // rewrite, the upstream should see /dns-query — not /secretpath. Crucially,
    // even though /dns-query is in the block list, subroute routes are
    // evaluated sequentially: the block route matched on the ORIGINAL URI
    // (/secretpath, which is not blocked), then the rewrite route ran. The
    // block route does NOT re-evaluate after the rewrite.
    const res = await httpGet(DOMAIN, '/secretpath');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/dns-query');
    expect(res.body).not.toMatch(/GET \/secretpath HTTP/);
  });

  test('second rewrite rule also takes effect', async () => {
    const res = await httpGet(DOMAIN, '/oldapi');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/v2/api');
  });

  test('unmatched path is proxied normally to the upstream', async () => {
    const res = await httpGet(DOMAIN, '/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/healthz');
  });
});
