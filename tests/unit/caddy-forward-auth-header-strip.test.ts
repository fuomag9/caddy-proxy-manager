/**
 * Regression: the generated Caddy config for CPM forward-auth hosts must STRIP
 * client-supplied X-CPM-* identity headers from the inbound request on EVERY
 * route that proxies to the upstream — protected, unprotected catch-all,
 * excluded, and location routes alike.
 *
 * Without this, a caller could spoof identity / group membership to upstream
 * apps: on unprotected/excluded paths the forged headers pass straight through
 * (no verify runs), and on authenticated routes the copy step only overwrites a
 * header when the verify response is non-empty (a user in no group returns an
 * empty X-CPM-Groups, which would otherwise leave the client's forged value
 * intact). See SECURITY-AUDIT H1.
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
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null => {
      if (!value) return null;
      return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
    },
  };
});

// Keep the real buildCaddyDocument (pure config builder) but stub the network
// apply so createProxyHost doesn't try to reach a live Caddy admin API.
vi.mock('../../src/lib/caddy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/caddy')>();
  return { ...actual, applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import { buildCaddyDocument } from '../../src/lib/caddy';
import * as schema from '../../src/lib/db/schema';

const CPM_HEADERS = ['X-CPM-User', 'X-CPM-Email', 'X-CPM-Groups', 'X-CPM-User-Id'];
const UPSTREAM = '10.0.0.5:8080';

/** Recursively collect every `handle` array anywhere in the config document. */
function collectHandleArrays(node: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(node)) {
    for (const item of node) collectHandleArrays(item, out);
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.handle)) out.push(obj.handle as unknown[]);
    for (const v of Object.values(obj)) collectHandleArrays(v, out);
  }
  return out;
}

function isUpstreamProxy(h: unknown): boolean {
  const handler = h as Record<string, unknown>;
  if (handler?.handler !== 'reverse_proxy') return false;
  const ups = (handler.upstreams as Array<{ dial?: string }> | undefined) ?? [];
  return ups.some((u) => u.dial === UPSTREAM);
}

function isCpmStrip(h: unknown): boolean {
  const handler = h as Record<string, unknown>;
  if (handler?.handler !== 'headers') return false;
  const del = (handler.request as { delete?: string[] } | undefined)?.delete;
  if (!Array.isArray(del)) return false;
  return CPM_HEADERS.every((name) => del.includes(name));
}

beforeEach(async () => {
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    provider: 'credentials',
    subject: 'admin',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('CPM forward-auth inbound X-CPM-* header stripping', () => {
  it('strips X-CPM-* before the upstream on a full-site protected host', async () => {
    await createProxyHost(
      {
        name: 'fa-fullsite',
        domains: ['app.example.com'],
        upstreams: [UPSTREAM],
        cpmForwardAuth: { enabled: true },
      },
      1
    );

    const doc = await buildCaddyDocument();
    const handleArrays = collectHandleArrays(doc);
    const upstreamRoutes = handleArrays.filter((arr) => arr.some(isUpstreamProxy));

    expect(upstreamRoutes.length).toBeGreaterThan(0);
    for (const arr of upstreamRoutes) {
      const stripIdx = arr.findIndex(isCpmStrip);
      const proxyIdx = arr.findIndex(isUpstreamProxy);
      expect(stripIdx).toBeGreaterThanOrEqual(0); // strip handler present
      expect(stripIdx).toBeLessThan(proxyIdx); // ...and before the upstream proxy
    }
  });

  it('strips X-CPM-* on UNPROTECTED excluded paths (no verify runs there)', async () => {
    await createProxyHost(
      {
        name: 'fa-excluded',
        domains: ['app2.example.com'],
        upstreams: [UPSTREAM],
        cpmForwardAuth: { enabled: true, excluded_paths: ['/public/*'] },
      },
      1
    );

    const doc = await buildCaddyDocument();
    const handleArrays = collectHandleArrays(doc);

    // The excluded-path route proxies to the upstream WITHOUT a forward-auth
    // subrequest. It must still carry the strip handler.
    const excludedRoute = handleArrays.find(
      (arr) =>
        arr.some(isUpstreamProxy) &&
        !arr.some(
          (h) =>
            (h as Record<string, unknown>)?.handler === 'reverse_proxy' &&
            JSON.stringify(h).includes('/api/forward-auth/verify')
        )
    );

    expect(excludedRoute).toBeDefined();
    expect(excludedRoute!.some(isCpmStrip)).toBe(true);
  });

  it('does not leak X-CPM-* stripping into a plain (non-forward-auth) host', async () => {
    await createProxyHost(
      { name: 'plain', domains: ['plain.example.com'], upstreams: [UPSTREAM] },
      1
    );

    const doc = await buildCaddyDocument();
    const handleArrays = collectHandleArrays(doc);
    const upstreamRoutes = handleArrays.filter((arr) => arr.some(isUpstreamProxy));

    expect(upstreamRoutes.length).toBeGreaterThan(0);
    // Plain hosts never deal in X-CPM-* headers, so no strip handler is emitted.
    for (const arr of upstreamRoutes) {
      expect(arr.some(isCpmStrip)).toBe(false);
    }
  });
});
