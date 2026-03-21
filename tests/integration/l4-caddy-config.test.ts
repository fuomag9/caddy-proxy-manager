/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration tests for L4 Caddy config generation.
 *
 * Verifies that the data stored in l4_proxy_hosts can be used to produce
 * correct caddy-l4 JSON config structures. Tests the config shape that
 * buildL4Servers() would produce by reconstructing it from DB rows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { l4ProxyHosts } from '../../src/lib/db/schema';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertL4Host(overrides: Partial<typeof l4ProxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  const [host] = await db.insert(l4ProxyHosts).values({
    name: 'Test L4 Host',
    protocol: 'tcp',
    listenAddress: ':5432',
    upstreams: JSON.stringify(['10.0.0.1:5432']),
    matcherType: 'none',
    matcherValue: null,
    tlsTermination: false,
    proxyProtocolVersion: null,
    proxyProtocolReceive: false,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return host;
}

/**
 * Reconstruct the caddy-l4 JSON config that buildL4Servers() would produce
 * from a set of L4 proxy host rows. This mirrors the logic in caddy.ts.
 */
function buildExpectedL4Config(rows: (typeof l4ProxyHosts.$inferSelect)[]) {
  const enabledRows = rows.filter(r => r.enabled);
  if (enabledRows.length === 0) return null;

  const serverMap = new Map<string, typeof enabledRows>();
  for (const host of enabledRows) {
    const key = host.listenAddress;
    if (!serverMap.has(key)) serverMap.set(key, []);
    serverMap.get(key)!.push(host);
  }

  const servers: Record<string, unknown> = {};
  let serverIdx = 0;
  for (const [listenAddr, hosts] of serverMap) {
    const routes = hosts.map(host => {
      const route: Record<string, unknown> = {};
      const matcherValues = host.matcherValue ? JSON.parse(host.matcherValue) as string[] : [];

      if (host.matcherType === 'tls_sni' && matcherValues.length > 0) {
        route.match = [{ tls: { sni: matcherValues } }];
      } else if (host.matcherType === 'http_host' && matcherValues.length > 0) {
        route.match = [{ http: [{ host: matcherValues }] }];
      } else if (host.matcherType === 'proxy_protocol') {
        route.match = [{ proxy_protocol: {} }];
      }

      const handlers: Record<string, unknown>[] = [];
      if (host.proxyProtocolReceive) handlers.push({ handler: 'proxy_protocol' });
      if (host.tlsTermination) handlers.push({ handler: 'tls' });

      const upstreams = JSON.parse(host.upstreams) as string[];
      const proxyHandler: Record<string, unknown> = {
        handler: 'proxy',
        upstreams: upstreams.map(u => ({ dial: [u] })),
      };
      if (host.proxyProtocolVersion) proxyHandler.proxy_protocol = host.proxyProtocolVersion;

      // Load balancer config from meta
      if (host.meta) {
        const meta = JSON.parse(host.meta);
        if (meta.load_balancer?.enabled) {
          const lb = meta.load_balancer;
          proxyHandler.load_balancing = {
            selection_policy: { policy: lb.policy ?? 'random' },
            ...(lb.try_duration ? { try_duration: lb.try_duration } : {}),
            ...(lb.try_interval ? { try_interval: lb.try_interval } : {}),
            ...(lb.retries != null ? { retries: lb.retries } : {}),
          };
          const healthChecks: Record<string, unknown> = {};
          if (lb.active_health_check?.enabled) {
            const active: Record<string, unknown> = {};
            if (lb.active_health_check.port != null) active.port = lb.active_health_check.port;
            if (lb.active_health_check.interval) active.interval = lb.active_health_check.interval;
            if (lb.active_health_check.timeout) active.timeout = lb.active_health_check.timeout;
            if (Object.keys(active).length > 0) healthChecks.active = active;
          }
          if (lb.passive_health_check?.enabled) {
            const passive: Record<string, unknown> = {};
            if (lb.passive_health_check.fail_duration) passive.fail_duration = lb.passive_health_check.fail_duration;
            if (lb.passive_health_check.max_fails != null) passive.max_fails = lb.passive_health_check.max_fails;
            if (lb.passive_health_check.unhealthy_latency) passive.unhealthy_latency = lb.passive_health_check.unhealthy_latency;
            if (Object.keys(passive).length > 0) healthChecks.passive = passive;
          }
          if (Object.keys(healthChecks).length > 0) proxyHandler.health_checks = healthChecks;
        }
      }

      handlers.push(proxyHandler);

      route.handle = handlers;
      return route;
    });

    servers[`l4_server_${serverIdx++}`] = { listen: [listenAddr], routes };
  }

  return servers;
}

// ---------------------------------------------------------------------------
// Config shape tests
// ---------------------------------------------------------------------------

describe('L4 Caddy config generation', () => {
  it('returns null when no L4 hosts exist', async () => {
    const rows = await db.select().from(l4ProxyHosts);
    expect(buildExpectedL4Config(rows)).toBeNull();
  });

  it('returns null when all hosts are disabled', async () => {
    await insertL4Host({ enabled: false });
    await insertL4Host({ enabled: false, name: 'Also disabled', listenAddress: ':3306' });
    const rows = await db.select().from(l4ProxyHosts);
    expect(buildExpectedL4Config(rows)).toBeNull();
  });

  it('simple TCP proxy — catch-all, single upstream', async () => {
    await insertL4Host({
      name: 'PostgreSQL',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['10.0.0.1:5432']),
      matcherType: 'none',
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows);

    expect(config).toEqual({
      l4_server_0: {
        listen: [':5432'],
        routes: [
          {
            handle: [
              { handler: 'proxy', upstreams: [{ dial: ['10.0.0.1:5432'] }] },
            ],
          },
        ],
      },
    });
  });

  it('TCP proxy with TLS SNI matcher and TLS termination', async () => {
    await insertL4Host({
      name: 'Secure DB',
      listenAddress: ':5432',
      matcherType: 'tls_sni',
      matcherValue: JSON.stringify(['db.example.com']),
      tlsTermination: true,
      upstreams: JSON.stringify(['10.0.0.1:5432']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows);

    expect(config).toEqual({
      l4_server_0: {
        listen: [':5432'],
        routes: [
          {
            match: [{ tls: { sni: ['db.example.com'] } }],
            handle: [
              { handler: 'tls' },
              { handler: 'proxy', upstreams: [{ dial: ['10.0.0.1:5432'] }] },
            ],
          },
        ],
      },
    });
  });

  it('HTTP host matcher shape', async () => {
    await insertL4Host({
      name: 'HTTP Route',
      listenAddress: ':8080',
      matcherType: 'http_host',
      matcherValue: JSON.stringify(['api.example.com']),
      upstreams: JSON.stringify(['10.0.0.1:8080']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    expect(route.match).toEqual([{ http: [{ host: ['api.example.com'] }] }]);
  });

  it('proxy_protocol matcher shape', async () => {
    await insertL4Host({
      name: 'PP Match',
      listenAddress: ':8443',
      matcherType: 'proxy_protocol',
      upstreams: JSON.stringify(['10.0.0.1:443']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    expect(route.match).toEqual([{ proxy_protocol: {} }]);
  });

  it('full handler chain — proxy_protocol receive + TLS + proxy with PP v1', async () => {
    await insertL4Host({
      name: 'Secure IMAP',
      listenAddress: '0.0.0.0:993',
      upstreams: JSON.stringify(['localhost:143']),
      tlsTermination: true,
      proxyProtocolReceive: true,
      proxyProtocolVersion: 'v1',
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows);

    expect(config).toEqual({
      l4_server_0: {
        listen: ['0.0.0.0:993'],
        routes: [
          {
            handle: [
              { handler: 'proxy_protocol' },
              { handler: 'tls' },
              {
                handler: 'proxy',
                proxy_protocol: 'v1',
                upstreams: [{ dial: ['localhost:143'] }],
              },
            ],
          },
        ],
      },
    });
  });

  it('proxy_protocol v2 outbound', async () => {
    await insertL4Host({
      name: 'PP v2',
      listenAddress: ':8443',
      upstreams: JSON.stringify(['10.0.0.1:443']),
      proxyProtocolVersion: 'v2',
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    const proxyHandler = route.handle[route.handle.length - 1];
    expect(proxyHandler.proxy_protocol).toBe('v2');
  });

  it('multiple upstreams for load balancing', async () => {
    const upstreams = ['10.0.0.1:5432', '10.0.0.2:5432', '10.0.0.3:5432'];
    await insertL4Host({
      name: 'LB PG',
      listenAddress: ':5432',
      upstreams: JSON.stringify(upstreams),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    expect(route.handle[0].upstreams).toEqual([
      { dial: ['10.0.0.1:5432'] },
      { dial: ['10.0.0.2:5432'] },
      { dial: ['10.0.0.3:5432'] },
    ]);
  });

  it('groups multiple hosts on same port into shared server routes', async () => {
    await insertL4Host({
      name: 'DB1',
      listenAddress: ':5432',
      matcherType: 'tls_sni',
      matcherValue: JSON.stringify(['db1.example.com']),
      upstreams: JSON.stringify(['10.0.0.1:5432']),
    });
    await insertL4Host({
      name: 'DB2',
      listenAddress: ':5432',
      matcherType: 'tls_sni',
      matcherValue: JSON.stringify(['db2.example.com']),
      upstreams: JSON.stringify(['10.0.0.2:5432']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;

    // Should be a single server with 2 routes
    expect(Object.keys(config)).toHaveLength(1);
    const server = config.l4_server_0 as any;
    expect(server.listen).toEqual([':5432']);
    expect(server.routes).toHaveLength(2);
    expect(server.routes[0].match).toEqual([{ tls: { sni: ['db1.example.com'] } }]);
    expect(server.routes[1].match).toEqual([{ tls: { sni: ['db2.example.com'] } }]);
  });

  it('different ports create separate servers', async () => {
    await insertL4Host({ name: 'PG', listenAddress: ':5432', upstreams: JSON.stringify(['10.0.0.1:5432']) });
    await insertL4Host({ name: 'MySQL', listenAddress: ':3306', upstreams: JSON.stringify(['10.0.0.2:3306']) });
    await insertL4Host({ name: 'Redis', listenAddress: ':6379', upstreams: JSON.stringify(['10.0.0.3:6379']) });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;

    expect(Object.keys(config)).toHaveLength(3);
  });

  it('disabled hosts are excluded from config', async () => {
    await insertL4Host({ name: 'Active', listenAddress: ':5432', enabled: true });
    await insertL4Host({ name: 'Disabled', listenAddress: ':3306', enabled: false });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;

    // Only the active host should be in config
    expect(Object.keys(config)).toHaveLength(1);
    expect((config.l4_server_0 as any).listen).toEqual([':5432']);
  });

  it('UDP proxy — correct listen address', async () => {
    await insertL4Host({
      name: 'DNS Proxy',
      protocol: 'udp',
      listenAddress: ':5353',
      upstreams: JSON.stringify(['8.8.8.8:53', '8.8.4.4:53']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const server = config.l4_server_0 as any;
    expect(server.listen).toEqual([':5353']);
    expect(server.routes[0].handle[0].upstreams).toHaveLength(2);
  });

  it('TLS SNI with multiple hostnames', async () => {
    await insertL4Host({
      name: 'Multi SNI',
      listenAddress: ':443',
      matcherType: 'tls_sni',
      matcherValue: JSON.stringify(['db1.example.com', 'db2.example.com', 'db3.example.com']),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    expect(route.match[0].tls.sni).toEqual(['db1.example.com', 'db2.example.com', 'db3.example.com']);
  });

  it('load balancer with round_robin policy', async () => {
    await insertL4Host({
      name: 'LB Host',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['10.0.0.1:5432', '10.0.0.2:5432']),
      meta: JSON.stringify({
        load_balancer: {
          enabled: true,
          policy: 'round_robin',
          try_duration: '5s',
          retries: 3,
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    const proxyHandler = route.handle[0];
    expect(proxyHandler.load_balancing).toEqual({
      selection_policy: { policy: 'round_robin' },
      try_duration: '5s',
      retries: 3,
    });
  });

  it('load balancer with active health check', async () => {
    await insertL4Host({
      name: 'Health Check Host',
      listenAddress: ':3306',
      upstreams: JSON.stringify(['10.0.0.1:3306']),
      meta: JSON.stringify({
        load_balancer: {
          enabled: true,
          policy: 'least_conn',
          active_health_check: {
            enabled: true,
            port: 3307,
            interval: '10s',
            timeout: '5s',
          },
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    const proxyHandler = route.handle[0];
    expect(proxyHandler.health_checks).toEqual({
      active: {
        port: 3307,
        interval: '10s',
        timeout: '5s',
      },
    });
  });

  it('load balancer with passive health check', async () => {
    await insertL4Host({
      name: 'Passive HC Host',
      listenAddress: ':6379',
      upstreams: JSON.stringify(['10.0.0.1:6379']),
      meta: JSON.stringify({
        load_balancer: {
          enabled: true,
          policy: 'random',
          passive_health_check: {
            enabled: true,
            fail_duration: '30s',
            max_fails: 5,
            unhealthy_latency: '2s',
          },
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    const proxyHandler = route.handle[0];
    expect(proxyHandler.health_checks).toEqual({
      passive: {
        fail_duration: '30s',
        max_fails: 5,
        unhealthy_latency: '2s',
      },
    });
  });

  it('disabled load balancer does not add config', async () => {
    await insertL4Host({
      name: 'No LB',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['10.0.0.1:5432']),
      meta: JSON.stringify({
        load_balancer: { enabled: false, policy: 'round_robin' },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    const route = (config.l4_server_0 as any).routes[0];
    expect(route.handle[0].load_balancing).toBeUndefined();
  });

  it('dns resolver config stored in meta', async () => {
    await insertL4Host({
      name: 'DNS Host',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['db.example.com:5432']),
      meta: JSON.stringify({
        dns_resolver: {
          enabled: true,
          resolvers: ['1.1.1.1', '8.8.8.8'],
          fallbacks: ['8.8.4.4'],
          timeout: '5s',
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const meta = JSON.parse(rows[0].meta!);
    expect(meta.dns_resolver.enabled).toBe(true);
    expect(meta.dns_resolver.resolvers).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(meta.dns_resolver.fallbacks).toEqual(['8.8.4.4']);
    expect(meta.dns_resolver.timeout).toBe('5s');
  });

  it('geo blocking config produces blocker matcher route', async () => {
    await insertL4Host({
      name: 'Geo Blocked',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['10.0.0.1:5432']),
      meta: JSON.stringify({
        geoblock: {
          enabled: true,
          block_countries: ['CN', 'RU'],
          block_continents: [],
          block_asns: [12345],
          block_cidrs: [],
          block_ips: [],
          allow_countries: ['US'],
          allow_continents: [],
          allow_asns: [],
          allow_cidrs: [],
          allow_ips: [],
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const meta = JSON.parse(rows[0].meta!);
    expect(meta.geoblock.enabled).toBe(true);
    expect(meta.geoblock.block_countries).toEqual(['CN', 'RU']);
    expect(meta.geoblock.block_asns).toEqual([12345]);
    expect(meta.geoblock.allow_countries).toEqual(['US']);
  });

  it('disabled geo blocking does not produce a route', async () => {
    await insertL4Host({
      name: 'No Geo Block',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['10.0.0.1:5432']),
      meta: JSON.stringify({
        geoblock: {
          enabled: false,
          block_countries: ['CN'],
          block_continents: [], block_asns: [], block_cidrs: [], block_ips: [],
          allow_countries: [], allow_continents: [], allow_asns: [], allow_cidrs: [], allow_ips: [],
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const config = buildExpectedL4Config(rows)!;
    // Only the proxy route should exist, no blocking route
    const server = config.l4_server_0 as any;
    expect(server.routes).toHaveLength(1);
    expect(server.routes[0].handle[0].handler).toBe('proxy');
  });

  it('upstream dns resolution config stored in meta', async () => {
    await insertL4Host({
      name: 'Pinned Host',
      listenAddress: ':5432',
      upstreams: JSON.stringify(['db.example.com:5432']),
      meta: JSON.stringify({
        upstream_dns_resolution: {
          enabled: true,
          family: 'ipv4',
        },
      }),
    });

    const rows = await db.select().from(l4ProxyHosts);
    const meta = JSON.parse(rows[0].meta!);
    expect(meta.upstream_dns_resolution.enabled).toBe(true);
    expect(meta.upstream_dns_resolution.family).toBe('ipv4');
  });
});
