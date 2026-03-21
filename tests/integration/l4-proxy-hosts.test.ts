import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { l4ProxyHosts } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

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

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts integration', () => {
  it('inserts and retrieves an L4 proxy host', async () => {
    const host = await insertL4Host();
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row).toBeDefined();
    expect(row!.name).toBe('Test L4 Host');
    expect(row!.protocol).toBe('tcp');
    expect(row!.listenAddress).toBe(':5432');
  });

  it('delete by id removes the host', async () => {
    const host = await insertL4Host();
    await db.delete(l4ProxyHosts).where(eq(l4ProxyHosts.id, host.id));
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row).toBeUndefined();
  });

  it('multiple L4 hosts — count is correct', async () => {
    await insertL4Host({ name: 'PG', listenAddress: ':5432' });
    await insertL4Host({ name: 'MySQL', listenAddress: ':3306' });
    await insertL4Host({ name: 'Redis', listenAddress: ':6379' });
    const rows = await db.select().from(l4ProxyHosts);
    expect(rows.length).toBe(3);
  });

  it('enabled field defaults to true', async () => {
    const host = await insertL4Host();
    expect(host.enabled).toBe(true);
  });

  it('can set enabled to false', async () => {
    const host = await insertL4Host({ enabled: false });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.enabled)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Protocol field
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts protocol', () => {
  it('stores TCP protocol', async () => {
    const host = await insertL4Host({ protocol: 'tcp' });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.protocol).toBe('tcp');
  });

  it('stores UDP protocol', async () => {
    const host = await insertL4Host({ protocol: 'udp' });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.protocol).toBe('udp');
  });
});

// ---------------------------------------------------------------------------
// JSON fields (upstreams, matcher_value)
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts JSON fields', () => {
  it('stores and retrieves upstreams array', async () => {
    const upstreams = ['10.0.0.1:5432', '10.0.0.2:5432', '10.0.0.3:5432'];
    const host = await insertL4Host({ upstreams: JSON.stringify(upstreams) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(JSON.parse(row!.upstreams)).toEqual(upstreams);
  });

  it('stores and retrieves matcher_value for TLS SNI', async () => {
    const matcherValue = ['db.example.com', 'db2.example.com'];
    const host = await insertL4Host({
      matcherType: 'tls_sni',
      matcherValue: JSON.stringify(matcherValue),
    });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.matcherType).toBe('tls_sni');
    expect(JSON.parse(row!.matcherValue!)).toEqual(matcherValue);
  });

  it('stores and retrieves matcher_value for HTTP host', async () => {
    const matcherValue = ['api.example.com'];
    const host = await insertL4Host({
      matcherType: 'http_host',
      matcherValue: JSON.stringify(matcherValue),
    });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.matcherType).toBe('http_host');
    expect(JSON.parse(row!.matcherValue!)).toEqual(matcherValue);
  });

  it('matcher_value is null for none matcher', async () => {
    const host = await insertL4Host({ matcherType: 'none', matcherValue: null });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.matcherType).toBe('none');
    expect(row!.matcherValue).toBeNull();
  });

  it('matcher_value is null for proxy_protocol matcher', async () => {
    const host = await insertL4Host({ matcherType: 'proxy_protocol', matcherValue: null });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.matcherType).toBe('proxy_protocol');
    expect(row!.matcherValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boolean fields
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts boolean fields', () => {
  it('tls_termination defaults to false', async () => {
    const host = await insertL4Host();
    expect(Boolean(host.tlsTermination)).toBe(false);
  });

  it('tls_termination can be set to true', async () => {
    const host = await insertL4Host({ tlsTermination: true });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.tlsTermination)).toBe(true);
  });

  it('proxy_protocol_receive defaults to false', async () => {
    const host = await insertL4Host();
    expect(Boolean(host.proxyProtocolReceive)).toBe(false);
  });

  it('proxy_protocol_receive can be set to true', async () => {
    const host = await insertL4Host({ proxyProtocolReceive: true });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.proxyProtocolReceive)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Proxy protocol version
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts proxy protocol version', () => {
  it('proxy_protocol_version defaults to null', async () => {
    const host = await insertL4Host();
    expect(host.proxyProtocolVersion).toBeNull();
  });

  it('stores v1 proxy protocol version', async () => {
    const host = await insertL4Host({ proxyProtocolVersion: 'v1' });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.proxyProtocolVersion).toBe('v1');
  });

  it('stores v2 proxy protocol version', async () => {
    const host = await insertL4Host({ proxyProtocolVersion: 'v2' });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.proxyProtocolVersion).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// Meta field
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts meta', () => {
  it('meta can be null', async () => {
    const host = await insertL4Host({ meta: null });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.meta).toBeNull();
  });

  it('stores and retrieves load balancer config via meta', async () => {
    const meta = {
      load_balancer: {
        enabled: true,
        policy: 'round_robin',
        try_duration: '5s',
        try_interval: '250ms',
        retries: 3,
        active_health_check: { enabled: true, port: 8081, interval: '10s', timeout: '5s' },
        passive_health_check: { enabled: true, fail_duration: '30s', max_fails: 5 },
      },
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.load_balancer.enabled).toBe(true);
    expect(parsed.load_balancer.policy).toBe('round_robin');
    expect(parsed.load_balancer.active_health_check.port).toBe(8081);
    expect(parsed.load_balancer.passive_health_check.max_fails).toBe(5);
  });

  it('stores and retrieves DNS resolver config via meta', async () => {
    const meta = {
      dns_resolver: {
        enabled: true,
        resolvers: ['1.1.1.1', '8.8.8.8'],
        fallbacks: ['8.8.4.4'],
        timeout: '5s',
      },
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.dns_resolver.enabled).toBe(true);
    expect(parsed.dns_resolver.resolvers).toEqual(['1.1.1.1', '8.8.8.8']);
    expect(parsed.dns_resolver.timeout).toBe('5s');
  });

  it('stores and retrieves upstream DNS resolution config via meta', async () => {
    const meta = {
      upstream_dns_resolution: { enabled: true, family: 'ipv4' },
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.upstream_dns_resolution.enabled).toBe(true);
    expect(parsed.upstream_dns_resolution.family).toBe('ipv4');
  });

  it('stores all three meta features together', async () => {
    const meta = {
      load_balancer: { enabled: true, policy: 'ip_hash' },
      dns_resolver: { enabled: true, resolvers: ['1.1.1.1'] },
      upstream_dns_resolution: { enabled: true, family: 'both' },
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.load_balancer.policy).toBe('ip_hash');
    expect(parsed.dns_resolver.resolvers).toEqual(['1.1.1.1']);
    expect(parsed.upstream_dns_resolution.family).toBe('both');
  });

  it('stores and retrieves geo blocking config via meta', async () => {
    const meta = {
      geoblock: {
        enabled: true,
        block_countries: ['CN', 'RU', 'KP'],
        block_continents: ['AF'],
        block_asns: [12345],
        block_cidrs: ['192.0.2.0/24'],
        block_ips: ['203.0.113.1'],
        allow_countries: ['US'],
        allow_continents: [],
        allow_asns: [],
        allow_cidrs: ['10.0.0.0/8'],
        allow_ips: [],
      },
      geoblock_mode: 'override',
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.geoblock.enabled).toBe(true);
    expect(parsed.geoblock.block_countries).toEqual(['CN', 'RU', 'KP']);
    expect(parsed.geoblock.allow_cidrs).toEqual(['10.0.0.0/8']);
    expect(parsed.geoblock_mode).toBe('override');
  });

  it('stores all four meta features together', async () => {
    const meta = {
      load_balancer: { enabled: true, policy: 'round_robin' },
      dns_resolver: { enabled: true, resolvers: ['1.1.1.1'] },
      upstream_dns_resolution: { enabled: true, family: 'ipv4' },
      geoblock: { enabled: true, block_countries: ['CN'], block_continents: [], block_asns: [], block_cidrs: [], block_ips: [], allow_countries: [], allow_continents: [], allow_asns: [], allow_cidrs: [], allow_ips: [] },
    };
    const host = await insertL4Host({ meta: JSON.stringify(meta) });
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.load_balancer.policy).toBe('round_robin');
    expect(parsed.geoblock.block_countries).toEqual(['CN']);
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe('l4-proxy-hosts update', () => {
  it('updates listen address', async () => {
    const host = await insertL4Host({ listenAddress: ':5432' });
    await db.update(l4ProxyHosts).set({ listenAddress: ':3306' }).where(eq(l4ProxyHosts.id, host.id));
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.listenAddress).toBe(':3306');
  });

  it('updates protocol from tcp to udp', async () => {
    const host = await insertL4Host({ protocol: 'tcp' });
    await db.update(l4ProxyHosts).set({ protocol: 'udp' }).where(eq(l4ProxyHosts.id, host.id));
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.protocol).toBe('udp');
  });

  it('toggles enabled state', async () => {
    const host = await insertL4Host({ enabled: true });
    await db.update(l4ProxyHosts).set({ enabled: false }).where(eq(l4ProxyHosts.id, host.id));
    const row = await db.query.l4ProxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.enabled)).toBe(false);
  });
});
