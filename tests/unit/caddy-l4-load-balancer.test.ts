/**
 * Unit tests for buildL4LoadBalancerHandlerConfig (src/lib/caddy.ts).
 *
 * caddy-l4's proxy handler (layer4.handlers.proxy) decodes its config
 * strictly and has a different schema from http.handlers.reverse_proxy, so
 * any HTTP-only field makes Caddy reject the entire config (issue #301).
 */
import { describe, it, expect, vi } from 'vitest';

vi.unmock('@/src/lib/caddy');

import { buildL4LoadBalancerHandlerConfig } from '@/src/lib/caddy';

// Every JSON field caddy-l4 v0.1.2 accepts in these blocks
// (modules/l4proxy/loadbalancing.go and healthchecks.go).
const CADDY_L4_LOAD_BALANCING_FIELDS = ['selection', 'try_duration', 'try_interval'];
const CADDY_L4_ACTIVE_FIELDS = ['port', 'interval', 'timeout', 'close_if_unhealthy', 'fall', 'rise'];
const CADDY_L4_PASSIVE_FIELDS = ['fail_duration', 'max_fails', 'unhealthy_connection_count'];

function expectOnlyCaddyL4Fields(config: Record<string, unknown>) {
  expect(Object.keys(config).every((k) => ['load_balancing', 'health_checks'].includes(k))).toBe(true);
  const lb = (config.load_balancing ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(lb)) expect(CADDY_L4_LOAD_BALANCING_FIELDS).toContain(key);
  const hc = (config.health_checks ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of Object.keys(hc.active ?? {})) expect(CADDY_L4_ACTIVE_FIELDS).toContain(key);
  for (const key of Object.keys(hc.passive ?? {})) expect(CADDY_L4_PASSIVE_FIELDS).toContain(key);
}

describe('buildL4LoadBalancerHandlerConfig', () => {
  it('returns nothing when load balancing is missing or disabled', () => {
    expect(buildL4LoadBalancerHandlerConfig(undefined)).toEqual({});
    expect(buildL4LoadBalancerHandlerConfig(null)).toEqual({});
    expect(buildL4LoadBalancerHandlerConfig({ enabled: false, policy: 'first' })).toEqual({});
  });

  it('builds the config from issue #301 using caddy-l4 field names', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      policy: 'first',
      try_duration: '5s',
      try_interval: '250ms',
      retries: 3,
      active_health_check: { enabled: true },
    });

    expect(config).toEqual({
      load_balancing: {
        selection: { policy: 'first' },
        try_duration: '5s',
        try_interval: '250ms',
      },
      health_checks: { active: {} },
    });
    expectOnlyCaddyL4Fields(config);
  });

  it('never emits HTTP-only fields still stored in legacy meta', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      policy: 'round_robin',
      retries: 5,
      policy_header_field: 'X-Foo',
      active_health_check: { enabled: true, uri: '/health', status: 200, body: 'ok', port: 8081 },
      passive_health_check: {
        enabled: true,
        fail_duration: '30s',
        max_fails: 3,
        unhealthy_latency: '1s',
        unhealthy_status: [500],
      },
    });

    expect(config).toEqual({
      load_balancing: { selection: { policy: 'round_robin' } },
      health_checks: {
        active: { port: 8081 },
        passive: { fail_duration: '30s', max_fails: 3 },
      },
    });
    expectOnlyCaddyL4Fields(config);
    expect(JSON.stringify(config)).not.toMatch(/retries|selection_policy|unhealthy_latency|unhealthy_status|expect_|"uri"/);
  });

  it.each(['random', 'round_robin', 'least_conn', 'ip_hash', 'first'])('passes through L4 policy %s', (policy) => {
    const config = buildL4LoadBalancerHandlerConfig({ enabled: true, policy });
    expect(config.load_balancing).toEqual({ selection: { policy } });
  });

  it.each(['header', 'cookie', 'uri_hash', 'bogus', undefined])('falls back to random for non-L4 policy %s', (policy) => {
    const config = buildL4LoadBalancerHandlerConfig({ enabled: true, policy });
    expect(config.load_balancing).toEqual({ selection: { policy: 'random' } });
  });

  it('emits all supported active health check fields', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      policy: 'least_conn',
      active_health_check: { enabled: true, port: 3307, interval: ' 10s ', timeout: '5s' },
    });
    expect(config.health_checks).toEqual({ active: { port: 3307, interval: '10s', timeout: '5s' } });
  });

  it('keeps active health checks enabled with caddy-l4 defaults when no values are set', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      active_health_check: { enabled: true, port: 0, interval: '  ' },
    });
    expect(config.health_checks).toEqual({ active: {} });
  });

  it('drops values caddy-l4 cannot decode into its int fields', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      active_health_check: { enabled: true, port: 80.5 },
      passive_health_check: { enabled: true, fail_duration: '30s', max_fails: 2.5 },
    });
    expect(config.health_checks).toEqual({ active: {}, passive: { fail_duration: '30s' } });
  });

  it('omits disabled or empty health checks', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      active_health_check: { enabled: false, port: 8081 },
      passive_health_check: { enabled: true, unhealthy_latency: '1s' },
    });
    expect(config.health_checks).toBeUndefined();
  });

  it('allows max_fails of zero', () => {
    const config = buildL4LoadBalancerHandlerConfig({
      enabled: true,
      passive_health_check: { enabled: true, max_fails: 0 },
    });
    expect(config.health_checks).toEqual({ passive: { max_fails: 0 } });
  });
});
