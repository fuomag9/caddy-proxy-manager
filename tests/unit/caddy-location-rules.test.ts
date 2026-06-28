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

  describe('per-rule load balancing & health checks', () => {
    it('omits load_balancing/health_checks when no load balancer is set', () => {
      const { reverseProxyHandler } = buildLocationReverseProxy(
        { path: '/api/*', upstreams: ['a:80', 'b:80'] },
        false,
        false
      );
      expect(reverseProxyHandler.load_balancing).toBeUndefined();
      expect(reverseProxyHandler.health_checks).toBeUndefined();
    });

    it('ignores a disabled load balancer', () => {
      const { reverseProxyHandler } = buildLocationReverseProxy(
        { path: '/api/*', upstreams: ['a:80', 'b:80'], load_balancer: { enabled: false, policy: 'round_robin' } },
        false,
        false
      );
      expect(reverseProxyHandler.load_balancing).toBeUndefined();
      expect(reverseProxyHandler.health_checks).toBeUndefined();
    });

    it('applies selection policy and retry settings', () => {
      const { reverseProxyHandler } = buildLocationReverseProxy(
        {
          path: '/api/*',
          upstreams: ['a:80', 'b:80'],
          load_balancer: { enabled: true, policy: 'round_robin', try_duration: '5s', try_interval: '250ms', retries: 3 },
        },
        false,
        false
      );
      expect(reverseProxyHandler.load_balancing).toEqual({
        selection_policy: { policy: 'round_robin' },
        try_duration: '5s',
        try_interval: '250ms',
        retries: 3,
      });
    });

    it('applies active and passive health checks', () => {
      const { reverseProxyHandler } = buildLocationReverseProxy(
        {
          path: '/api/*',
          upstreams: ['a:80', 'b:80'],
          load_balancer: {
            enabled: true,
            policy: 'random',
            active_health_check: { enabled: true, uri: '/health', port: 8081, interval: '30s', timeout: '5s', status: 200 },
            passive_health_check: { enabled: true, fail_duration: '30s', max_fails: 5, unhealthy_status: [500, 502, 503] },
          },
        },
        false,
        false
      );
      expect(reverseProxyHandler.health_checks).toEqual({
        active: { uri: '/health', port: 8081, interval: '30s', timeout: '5s', expect_status: 200 },
        passive: { fail_duration: '30s', max_fails: 5, unhealthy_status: [500, 502, 503] },
      });
    });
  });
});
