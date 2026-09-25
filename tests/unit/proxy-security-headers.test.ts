/**
 * Public routes (/login, /portal, ...) get the same nonce-based CSP as the
 * dashboard. After a password login the browser keeps the /login document, so
 * that document's policy is what protects the dashboard until a reload.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '@/proxy';
import { buildCsp } from '@/src/lib/csp';

describe('middleware security headers on public routes', () => {
  it.each(['/login', '/portal'])('sends a nonce-based script policy on %s', async (path) => {
    const res = await middleware(new NextRequest(`http://localhost:3000${path}`));
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('overwrites a client-supplied CSP request header used for the nonce', async () => {
    const res = await middleware(
      new NextRequest('http://localhost:3000/login', {
        headers: { 'content-security-policy': "script-src 'nonce-attacker'" },
      })
    );
    const forwarded = res.headers.get('x-middleware-request-content-security-policy') ?? '';
    expect(forwarded).not.toContain('attacker');
    expect(forwarded).toBe(res.headers.get('content-security-policy'));
  });
});

describe('buildCsp', () => {
  it('restricts base URI, plugins and form targets', () => {
    const csp = buildCsp('n');
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });
});
