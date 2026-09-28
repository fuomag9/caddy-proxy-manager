/**
 * caddy-l4 has no `retries` and no passive `unhealthy_latency` (issue #301), so
 * the L4 load balancer no longer stores or returns them. Hosts saved by older
 * versions may still carry them in meta; they must be ignored, and dropped the
 * next time the load balancer is saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { l4ProxyHosts, users } from '@/src/lib/db/schema';

let db: TestDb;

vi.mock('@/src/lib/db', () => ({
  get default() { return db; },
  get sqlite() { return undefined; },
  nowIso: () => new Date().toISOString(),
  toIso: (value: string | Date | null | undefined): string | null => {
    if (!value) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  },
}));

import { createL4ProxyHost, getL4ProxyHost, updateL4ProxyHost } from '@/src/lib/models/l4-proxy-hosts';

beforeEach(async () => {
  db = createTestDb();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id: 1, email: 'admin@example.com', role: 'admin', status: 'active', createdAt: now, updatedAt: now,
  });
});

async function storedLoadBalancerMeta(id: number) {
  const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  return JSON.parse(row!.meta!).load_balancer as Record<string, any>;
}

const legacyLoadBalancer = {
  enabled: true,
  policy: 'first',
  tryDuration: '5s',
  tryInterval: '250ms',
  retries: 3,
  activeHealthCheck: { enabled: true, port: null, interval: null, timeout: null },
  passiveHealthCheck: { enabled: true, failDuration: '30s', maxFails: 3, unhealthyLatency: '5s' },
} as any;

describe('L4 load balancer legacy fields', () => {
  it('does not store retries or unhealthyLatency sent by an API client', async () => {
    const host = await createL4ProxyHost({
      name: 'LB',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.1:5432', '10.0.0.2:5432'],
      matcherType: 'none',
      loadBalancer: legacyLoadBalancer,
    } as any, 1);

    const meta = await storedLoadBalancerMeta(host.id);
    expect(meta).toEqual({
      enabled: true,
      policy: 'first',
      try_duration: '5s',
      try_interval: '250ms',
      active_health_check: { enabled: true },
      passive_health_check: { enabled: true, fail_duration: '30s', max_fails: 3 },
    });
    expect(host.loadBalancer).not.toHaveProperty('retries');
    expect(host.loadBalancer?.passiveHealthCheck).not.toHaveProperty('unhealthyLatency');
  });

  it('does not return legacy values already stored on a host', async () => {
    const now = new Date().toISOString();
    const [row] = await db.insert(l4ProxyHosts).values({
      name: 'Legacy',
      protocol: 'tcp',
      listenAddress: ':5433',
      upstreams: JSON.stringify(['10.0.0.1:5433']),
      matcherType: 'none',
      matcherValue: null,
      tlsTermination: false,
      proxyProtocolVersion: null,
      proxyProtocolReceive: false,
      enabled: true,
      meta: JSON.stringify({
        load_balancer: {
          enabled: true,
          policy: 'round_robin',
          retries: 4,
          passive_health_check: { enabled: true, fail_duration: '30s', unhealthy_latency: '2s' },
        },
      }),
      createdAt: now,
      updatedAt: now,
    }).returning();

    const host = await getL4ProxyHost(row.id);
    expect(host?.loadBalancer).toMatchObject({ enabled: true, policy: 'round_robin' });
    expect(host?.loadBalancer).not.toHaveProperty('retries');
    expect(host?.loadBalancer?.passiveHealthCheck).not.toHaveProperty('unhealthyLatency');
  });

  it('drops legacy values from storage the next time the load balancer is saved', async () => {
    const now = new Date().toISOString();
    const [row] = await db.insert(l4ProxyHosts).values({
      name: 'Legacy',
      protocol: 'tcp',
      listenAddress: ':5434',
      upstreams: JSON.stringify(['10.0.0.1:5434']),
      matcherType: 'none',
      matcherValue: null,
      tlsTermination: false,
      proxyProtocolVersion: null,
      proxyProtocolReceive: false,
      enabled: true,
      meta: JSON.stringify({
        load_balancer: { enabled: true, policy: 'first', retries: 4 },
      }),
      createdAt: now,
      updatedAt: now,
    }).returning();

    await updateL4ProxyHost(row.id, { loadBalancer: { ...legacyLoadBalancer, tryDuration: '10s' } } as any, 1);

    const meta = await storedLoadBalancerMeta(row.id);
    expect(meta).not.toHaveProperty('retries');
    expect(meta.try_duration).toBe('10s');
    expect(meta.passive_health_check).not.toHaveProperty('unhealthy_latency');
  });
});
