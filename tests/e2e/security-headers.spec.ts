import { test, expect } from '@playwright/test';

/**
 * Anti-clickjacking headers on public pages. The login and forward-auth portal
 * forms previously shipped with no framing protection (the headers were only set
 * on the authenticated branch of the middleware); they must now carry both
 * X-Frame-Options: DENY and a CSP frame-ancestors 'none'.
 */

const BASE_URL = 'http://localhost:3000';

for (const path of ['/login', '/portal']) {
  test(`public page ${path} cannot be framed (X-Frame-Options + CSP frame-ancestors)`, async ({ request }) => {
    const resp = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 });
    const headers = resp.headers();

    expect((headers['x-frame-options'] ?? '').toUpperCase()).toBe('DENY');
    expect(headers['content-security-policy'] ?? '').toMatch(/frame-ancestors\s+'none'/i);
    expect((headers['x-content-type-options'] ?? '').toLowerCase()).toBe('nosniff');
  });
}
