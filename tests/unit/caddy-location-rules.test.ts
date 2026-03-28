/**
 * Unit tests for buildLocationReverseProxy (src/lib/caddy.ts).
 * Tests the Caddy config building block for location-based routing.
 */
import { describe, it, expect, vi } from 'vitest';

// Undo the global mock so we can import the real function
vi.unmock('@/src/lib/caddy');

import { buildLocationReverseProxy } from '@/src/lib/caddy';

describe('buildLocationReverseProxy', () => {
  it('builds basic HTTP reverse proxy with single upstream', () => {
    const { safePath, reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/api/*', upstreams: ['backend:3000'] },
      false,
      false
    );

    expect(safePath).toBe('/api/*');
    expect(reverseProxyHandler).toEqual({
      handler: 'reverse_proxy',
      upstreams: [{ dial: 'backend:3000' }],
    });
  });

  it('builds reverse proxy with multiple upstreams', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/ws/*', upstreams: ['ws1:8080', 'ws2:8080', 'ws3:8080'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([
      { dial: 'ws1:8080' },
      { dial: 'ws2:8080' },
      { dial: 'ws3:8080' },
    ]);
  });

  it('parses http:// upstream URLs into dial format', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/api/*', upstreams: ['http://backend:3000'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([{ dial: 'backend:3000' }]);
    expect(reverseProxyHandler.transport).toBeUndefined();
  });

  it('parses https:// upstream URLs and adds TLS transport', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/secure/*', upstreams: ['https://backend:443'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([{ dial: 'backend:443' }]);
    expect(reverseProxyHandler.transport).toEqual({
      protocol: 'http',
      tls: {},
    });
  });

  it('sets insecure_skip_verify when skipHttpsValidation is true', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/secure/*', upstreams: ['https://backend:443'] },
      true,
      false
    );

    expect(reverseProxyHandler.transport).toEqual({
      protocol: 'http',
      tls: { insecure_skip_verify: true },
    });
  });

  it('does not add TLS transport for HTTP-only upstreams even with skipHttpsValidation', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/api/*', upstreams: ['backend:3000'] },
      true,
      false
    );

    expect(reverseProxyHandler.transport).toBeUndefined();
  });

  it('preserves host header when preserveHostHeader is true', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/api/*', upstreams: ['backend:3000'] },
      false,
      true
    );

    expect(reverseProxyHandler.headers).toEqual({
      request: { set: { Host: ['{http.request.host}'] } },
    });
  });

  it('does not set host header when preserveHostHeader is false', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/api/*', upstreams: ['backend:3000'] },
      false,
      false
    );

    expect(reverseProxyHandler.headers).toBeUndefined();
  });

  it('sanitizes Caddy placeholder injection from path', () => {
    const { safePath } = buildLocationReverseProxy(
      { path: '/api/{http.request.uri}/*', upstreams: ['backend:3000'] },
      false,
      false
    );

    expect(safePath).toBe('/api//*');
  });

  it('returns empty safePath when path is entirely a placeholder', () => {
    const { safePath } = buildLocationReverseProxy(
      { path: '{http.request.uri}', upstreams: ['backend:3000'] },
      false,
      false
    );

    expect(safePath).toBe('');
  });

  it('handles mixed HTTP and HTTPS upstreams — TLS transport added', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/mixed/*', upstreams: ['http://backend1:80', 'https://backend2:443'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([
      { dial: 'backend1:80' },
      { dial: 'backend2:443' },
    ]);
    expect(reverseProxyHandler.transport).toEqual({
      protocol: 'http',
      tls: {},
    });
  });

  it('handles HTTPS upstream with default port 443', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/secure/*', upstreams: ['https://backend'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([{ dial: 'backend:443' }]);
  });

  it('combines preserve host header + HTTPS transport correctly', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/all-options/*', upstreams: ['https://backend:8443'] },
      true,
      true
    );

    expect(reverseProxyHandler.handler).toBe('reverse_proxy');
    expect(reverseProxyHandler.headers).toEqual({
      request: { set: { Host: ['{http.request.host}'] } },
    });
    expect(reverseProxyHandler.transport).toEqual({
      protocol: 'http',
      tls: { insecure_skip_verify: true },
    });
  });

  it('handles IPv6 upstream addresses', () => {
    const { reverseProxyHandler } = buildLocationReverseProxy(
      { path: '/v6/*', upstreams: ['[::1]:8080'] },
      false,
      false
    );

    expect(reverseProxyHandler.upstreams).toEqual([{ dial: '[::1]:8080' }]);
  });
});
