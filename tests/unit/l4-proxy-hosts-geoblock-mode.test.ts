/**
 * Regression: L4 geoblockMode (override / merge) must round-trip through
 * createL4ProxyHost and updateL4ProxyHost.
 *
 * Bug A: `parseL4GeoBlockConfig` returned `geoblock_mode` (snake_case),
 * but L4ProxyHostInput uses `geoblockMode`, so the spread silently dropped
 * the field.
 *
 * Bug B: `updateL4ProxyHost` gated its meta-update branch on
 * `input.meta / loadBalancer / dnsResolver / upstreamDnsResolution`,
 * omitting geoblock — so updates that only changed geoblock were no-ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

vi.mock('../../src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../src/lib/audit', () => ({
  logAuditEvent: vi.fn(),
}));

import {
  createL4ProxyHost,
  updateL4ProxyHost,
  getL4ProxyHost,
  type L4ProxyHostInput,
} from '../../src/lib/models/l4-proxy-hosts';
import * as schema from '../../src/lib/db/schema';

const baseGeoblock = {
  enabled: true,
  block_countries: [],
  block_continents: [],
  block_asns: [],
  block_cidrs: ['0.0.0.0/0'],
  block_ips: [],
  allow_countries: [],
  allow_continents: [],
  allow_asns: [],
  allow_cidrs: ['10.0.0.0/8'],
  allow_ips: [],
};

beforeEach(async () => {
  await ctx.db.delete(schema.l4ProxyHosts);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    provider: 'credentials',
    subject: 'test',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('L4 proxy host geoblockMode persistence', () => {
  it('persists geoblockMode=override on create', async () => {
    const input: L4ProxyHostInput = {
      name: 'l4-override',
      protocol: 'tcp',
      listenAddress: ':5432',
      upstreams: ['10.0.0.5:5432'],
      geoblock: baseGeoblock,
      geoblockMode: 'override',
    };
    const host = await createL4ProxyHost(input, 1);
    expect((await getL4ProxyHost(host.id))?.geoblockMode).toBe('override');
  });

  it('switches geoblockMode merge -> override via update (geoblock-only change)', async () => {
    const host = await createL4ProxyHost(
      {
        name: 'l4-switch',
        protocol: 'tcp',
        listenAddress: ':5433',
        upstreams: ['10.0.0.5:5433'],
        geoblock: baseGeoblock,
        geoblockMode: 'merge',
      },
      1
    );
    expect((await getL4ProxyHost(host.id))?.geoblockMode).toBe('merge');

    // Update only touches geoblockMode — must still go through the meta branch.
    await updateL4ProxyHost(host.id, { geoblockMode: 'override' }, 1);
    expect((await getL4ProxyHost(host.id))?.geoblockMode).toBe('override');
  });

  it('updates geoblock-only without touching other fields', async () => {
    const host = await createL4ProxyHost(
      {
        name: 'l4-geo-only',
        protocol: 'tcp',
        listenAddress: ':5434',
        upstreams: ['10.0.0.5:5434'],
      },
      1
    );
    expect((await getL4ProxyHost(host.id))?.geoblock).toBeNull();

    await updateL4ProxyHost(host.id, { geoblock: baseGeoblock, geoblockMode: 'override' }, 1);
    const fetched = await getL4ProxyHost(host.id);
    expect(fetched?.geoblock?.enabled).toBe(true);
    expect(fetched?.geoblockMode).toBe('override');
  });
});
