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

const AUTHENTIK_HEADERS = ['X-Authentik-Username', 'X-Authentik-Groups', 'X-Authentik-Email'];

function isAuthentikStrip(h: unknown): boolean {
  const handler = h as Record<string, unknown>;
  if (handler?.handler !== 'headers') return false;
  const del = (handler.request as { delete?: string[] } | undefined)?.delete;
  if (!Array.isArray(del)) return false;
  return AUTHENTIK_HEADERS.every((name) => del.includes(name));
}

function expectStripBeforeEveryUpstream(doc: unknown) {
  const upstreamRoutes = collectHandleArrays(doc).filter((arr) => arr.some(isUpstreamProxy));
  expect(upstreamRoutes.length).toBeGreaterThan(0);
  for (const arr of upstreamRoutes) {
    const stripIdx = arr.findIndex(isAuthentikStrip);
    const proxyIdx = arr.findIndex(isUpstreamProxy);
    expect(stripIdx).toBeGreaterThanOrEqual(0);
    expect(stripIdx).toBeLessThan(proxyIdx);
  }
  return upstreamRoutes;
}

const authentikBase = {
  enabled: true,
  outpostDomain: 'outpost.goauthentik.io',
  outpostUpstream: 'http://authentik-server:9000',
  copyHeaders: AUTHENTIK_HEADERS,
};

describe('Authentik forward-auth inbound identity header stripping', () => {
  it('strips copy headers before the upstream on a full-site protected host', async () => {
    await createProxyHost(
      {
        name: 'ak-fullsite',
        domains: ['ak.example.com'],
        upstreams: [UPSTREAM],
        authentik: authentikBase,
        locationRules: [{ path: '/api/*', upstreams: [UPSTREAM] }],
      },
      1
    );
    expectStripBeforeEveryUpstream(await buildCaddyDocument());
  });

  it('strips copy headers on excluded (unauthenticated) paths', async () => {
    await createProxyHost(
      {
        name: 'ak-excluded',
        domains: ['ak2.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, excludedPaths: ['/public/*'] },
      },
      1
    );
    const routes = expectStripBeforeEveryUpstream(await buildCaddyDocument());
    // At least one upstream route runs without the outpost subrequest.
    expect(
      routes.some((arr) => !arr.some((h) => JSON.stringify(h).includes('authentik-server:9000')))
    ).toBe(true);
  });

  it('strips copy headers on the unprotected catch-all and location routes in protected-paths mode', async () => {
    await createProxyHost(
      {
        name: 'ak-protected',
        domains: ['ak3.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, protectedPaths: ['/admin/*'] },
        locationRules: [{ path: '/api/*', upstreams: [UPSTREAM] }],
      },
      1
    );
    expectStripBeforeEveryUpstream(await buildCaddyDocument());
  });

  it('drops copy header names that are not valid header tokens', async () => {
    await createProxyHost(
      {
        name: 'ak-badname',
        domains: ['ak4.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, copyHeaders: [...AUTHENTIK_HEADERS, 'X-Bad}{Name'] },
      },
      1
    );
    const json = JSON.stringify(await buildCaddyDocument());
    expect(json).not.toContain('X-Bad}{Name');
  });
});

// ── Credential headers, underscore spellings, copy placeholders ─────────

type Handler = Record<string, unknown>;

/** Every `delete` list of a `headers` handler that runs before the upstream proxy. */
function stripListsBeforeUpstream(doc: unknown): string[][] {
  const lists: string[][] = [];
  for (const arr of collectHandleArrays(doc)) {
    const proxyIdx = arr.findIndex(isUpstreamProxy);
    if (proxyIdx < 0) continue;
    for (const h of arr.slice(0, proxyIdx) as Handler[]) {
      const del = (h?.request as { delete?: string[] } | undefined)?.delete;
      if (h?.handler === 'headers' && Array.isArray(del)) lists.push(del);
    }
  }
  return lists;
}

/** Every reverse_proxy handler in the document whose upstream is not the app. */
function authSubrequestHandlers(doc: unknown): Handler[] {
  const out: Handler[] = [];
  (function walk(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object') {
      const obj = node as Handler;
      if (obj.handler === 'reverse_proxy' && obj.handle_response) out.push(obj);
      Object.values(obj).forEach(walk);
    }
  })(doc);
  return out;
}

/** The header name -> placeholder pairs a copy step sets on 2xx. */
function copySteps(handler: Handler): Array<{ set: Record<string, string[]>; matchKey: string }> {
  const entries = handler.handle_response as Array<{ match?: { status_code?: number[] }; routes?: Handler[] }>;
  const ok = entries.find((e) => e.match?.status_code?.includes(2));
  const steps: Array<{ set: Record<string, string[]>; matchKey: string }> = [];
  for (const route of ok?.routes ?? []) {
    const set = ((route.handle as Handler[] | undefined)?.[0]?.request as { set?: Record<string, string[]> } | undefined)?.set;
    const not = (route.match as Array<{ not?: Array<{ vars?: Record<string, string[]> }> }> | undefined)?.[0]?.not;
    if (set && not) steps.push({ set, matchKey: Object.keys(not[0].vars ?? {})[0] });
  }
  return steps;
}

const CREDENTIAL_HEADERS = ['Authorization', 'Proxy-Authorization', 'Cookie'];

function expectCredentialHeadersKept(lists: string[][]) {
  expect(lists.length).toBeGreaterThan(0);
  for (const del of lists) {
    const lower = del.map((name) => name.toLowerCase().replace(/_/g, '-'));
    for (const cred of CREDENTIAL_HEADERS) expect(lower).not.toContain(cred.toLowerCase());
  }
}

describe('identity-header strip leaves client credentials alone', () => {
  it('keeps Authorization/Cookie on every Authentik route but still copies them from the outpost', async () => {
    await createProxyHost(
      {
        name: 'ak-creds',
        domains: ['ak-creds.example.com'],
        upstreams: [UPSTREAM],
        authentik: {
          ...authentikBase,
          copyHeaders: [...AUTHENTIK_HEADERS, ...CREDENTIAL_HEADERS],
          excludedPaths: ['/api/*'],
        },
      },
      1
    );
    const doc = await buildCaddyDocument();
    expectStripBeforeEveryUpstream(doc);
    expectCredentialHeadersKept(stripListsBeforeUpstream(doc));

    const [outpost] = authSubrequestHandlers(doc);
    const copied = copySteps(outpost).flatMap((step) => Object.keys(step.set));
    expect(copied).toEqual(expect.arrayContaining([...AUTHENTIK_HEADERS, ...CREDENTIAL_HEADERS]));
  });

  it('keeps Authorization/Cookie on every generic forward-auth route but still copies them', async () => {
    await createProxyHost(
      {
        name: 'fa-creds',
        domains: ['fa-creds.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['Remote-User', ...CREDENTIAL_HEADERS],
          excludedPaths: ['/api/*'],
        },
      },
      1
    );
    const doc = await buildCaddyDocument();
    const lists = stripListsBeforeUpstream(doc);
    expectCredentialHeadersKept(lists);
    for (const del of lists) expect(del).toContain('Remote-User');

    const [auth] = authSubrequestHandlers(doc);
    const copied = copySteps(auth).flatMap((step) => Object.keys(step.set));
    expect(copied).toEqual(expect.arrayContaining(['Remote-User', ...CREDENTIAL_HEADERS]));
  });

  it('emits no strip handler when only credential headers are copied', async () => {
    await createProxyHost(
      {
        name: 'fa-only-creds',
        domains: ['fa-only-creds.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['Authorization'],
        },
      },
      1
    );
    expect(stripListsBeforeUpstream(await buildCaddyDocument())).toEqual([]);
  });
});

describe('identity-header strip covers underscore spellings', () => {
  it('deletes the underscore form of every CPM identity header', async () => {
    await createProxyHost(
      { name: 'cpm-us', domains: ['cpm-us.example.com'], upstreams: [UPSTREAM], cpmForwardAuth: { enabled: true } },
      1
    );
    const lists = stripListsBeforeUpstream(await buildCaddyDocument());
    expect(lists.length).toBeGreaterThan(0);
    for (const del of lists) {
      expect(del).toEqual(expect.arrayContaining([...CPM_HEADERS, 'X_CPM_User', 'X_CPM_Email', 'X_CPM_Groups', 'X_CPM_User_Id']));
    }
  });

  it('deletes the underscore form of every Authentik copy header', async () => {
    await createProxyHost(
      {
        name: 'ak-us',
        domains: ['ak-us.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, excludedPaths: ['/public/*'] },
      },
      1
    );
    const lists = stripListsBeforeUpstream(await buildCaddyDocument());
    expect(lists.length).toBeGreaterThan(0);
    for (const del of lists) {
      expect(del).toEqual(expect.arrayContaining(['X_Authentik_Username', 'X_Authentik_Groups', 'X_Authentik_Email']));
    }
  });

  it('deletes both spellings of generic copy headers, whichever one is configured', async () => {
    await createProxyHost(
      {
        name: 'fa-us',
        domains: ['fa-us.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['Remote-User', 'X_Custom_Groups'],
        },
      },
      1
    );
    const lists = stripListsBeforeUpstream(await buildCaddyDocument());
    expect(lists.length).toBeGreaterThan(0);
    for (const del of lists) {
      expect(del).toEqual(expect.arrayContaining(['Remote-User', 'Remote_User', 'X_Custom_Groups', 'X-Custom-Groups']));
    }
  });
});

/** Go's textproto.CanonicalMIMEHeaderKey, the form Caddy's header `delete` matches on. */
function goCanonicalHeaderKey(name: string): string {
  return name.toLowerCase().replace(/(^|-)([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/** Every spelling of `name` with each separator either "-" or "_". */
function separatorMixes(name: string): string[] {
  const i = name.search(/[-_]/);
  if (i < 0) return [name];
  const head = name.slice(0, i);
  return separatorMixes(name.slice(i + 1)).flatMap((tail) => [`${head}-${tail}`, `${head}_${tail}`]);
}

/** Asserts every pre-upstream delete list removes every separator mix of `headers`. */
function expectAllSeparatorMixesDeleted(doc: unknown, headers: string[], examples: string[]) {
  const lists = stripListsBeforeUpstream(doc);
  expect(lists.length).toBeGreaterThan(0);
  for (const del of lists) {
    const deleted = new Set(del.map(goCanonicalHeaderKey));
    // No entry is redundant under Caddy's case-insensitive matching.
    expect(deleted.size).toBe(del.length);
    for (const name of [...examples, ...headers.flatMap(separatorMixes)]) {
      expect(deleted.has(goCanonicalHeaderKey(name)), name).toBe(true);
    }
  }
}

describe('identity-header strip covers mixed separator spellings', () => {
  it('deletes every "-"/"_" mix of the CPM identity headers', async () => {
    await createProxyHost(
      { name: 'cpm-mix', domains: ['cpm-mix.example.com'], upstreams: [UPSTREAM], cpmForwardAuth: { enabled: true } },
      1
    );
    expectAllSeparatorMixesDeleted(await buildCaddyDocument(), CPM_HEADERS, [
      'X-CPM_User',
      'X-Cpm-User_Id',
      'x_cpm-user_id',
    ]);
  });

  it('deletes every "-"/"_" mix of the Authentik copy headers', async () => {
    const copyHeaders = [...AUTHENTIK_HEADERS, 'X-Authentik-Meta-Provider'];
    await createProxyHost(
      {
        name: 'ak-mix',
        domains: ['ak-mix.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, copyHeaders, excludedPaths: ['/public/*'] },
      },
      1
    );
    expectAllSeparatorMixesDeleted(await buildCaddyDocument(), copyHeaders, [
      'X-Authentik_Username',
      'X_Authentik-Username',
      'X-Authentik-Meta_Provider',
    ]);
  });

  it('deletes every "-"/"_" mix of generic copy headers', async () => {
    await createProxyHost(
      {
        name: 'fa-mix',
        domains: ['fa-mix.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['Remote-User', 'X_Custom-Groups'],
        },
      },
      1
    );
    expectAllSeparatorMixesDeleted(
      await buildCaddyDocument(),
      ['Remote-User', 'X_Custom-Groups'],
      ['Remote_User', 'X-Custom_Groups', 'x-custom-groups']
    );
  });

  it('falls back to the uniform spellings for names with more than six separators', async () => {
    await createProxyHost(
      {
        name: 'fa-long',
        domains: ['fa-long.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['X-A-B-C-D-E-F', 'X-A-B-C-D-E-F-G'],
        },
      },
      1
    );
    const lists = stripListsBeforeUpstream(await buildCaddyDocument());
    expect(lists.length).toBeGreaterThan(0);
    for (const del of lists) {
      // 2^6 mixes of the six-separator name, two spellings of the longer one.
      expect(del).toHaveLength(64 + 2);
      expect(del).toEqual(expect.arrayContaining([...separatorMixes('X-A-B-C-D-E-F'), 'X-A-B-C-D-E-F-G', 'X_A_B_C_D_E_F_G']));
    }
  });

  it('never deletes a credential header, whichever separator its configured name uses', async () => {
    await createProxyHost(
      {
        name: 'fa-cred-us',
        domains: ['fa-cred-us.example.com'],
        upstreams: [UPSTREAM],
        forwardAuth: {
          enabled: true,
          provider: 'custom',
          authUpstream: 'http://auth.example.com:9091',
          authEndpoint: '/verify',
          copyHeaders: ['Proxy_Authorization', 'COOKIE'],
        },
      },
      1
    );
    expect(stripListsBeforeUpstream(await buildCaddyDocument())).toEqual([]);
  });
});

describe('forward-auth copy step placeholders', () => {
  it('reads auth response headers under their canonical names', async () => {
    await createProxyHost(
      { name: 'cpm-canon', domains: ['cpm-canon.example.com'], upstreams: [UPSTREAM], cpmForwardAuth: { enabled: true } },
      1
    );
    await createProxyHost(
      {
        name: 'ak-canon',
        domains: ['ak-canon.example.com'],
        upstreams: [UPSTREAM],
        authentik: { ...authentikBase, copyHeaders: ['x-authentik-username'] },
      },
      1
    );
    const doc = await buildCaddyDocument();
    const steps = authSubrequestHandlers(doc).flatMap(copySteps);
    const byHeader = new Map(steps.map((step) => [Object.keys(step.set)[0], step]));

    // Caddy registers {http.reverse_proxy.header.*} under Go's canonical
    // header key, and the lookup is case-sensitive.
    for (const [name, canonical] of [
      ['X-CPM-User', 'X-Cpm-User'],
      ['X-CPM-Email', 'X-Cpm-Email'],
      ['X-CPM-Groups', 'X-Cpm-Groups'],
      ['X-CPM-User-Id', 'X-Cpm-User-Id'],
      ['x-authentik-username', 'X-Authentik-Username'],
    ]) {
      const step = byHeader.get(name);
      expect(step, name).toBeDefined();
      expect(step!.set[name]).toEqual([`{http.reverse_proxy.header.${canonical}}`]);
      expect(step!.matchKey).toBe(`{http.reverse_proxy.header.${canonical}}`);
    }
  });
});

describe('CPM forward-auth portal redirect', () => {
  it('takes the encoded target from the verify response and escapes the URI itself otherwise', async () => {
    await createProxyHost(
      { name: 'cpm-portal', domains: ['cpm-portal.example.com'], upstreams: [UPSTREAM], cpmForwardAuth: { enabled: true } },
      1
    );
    const doc = await buildCaddyDocument();
    const verify = authSubrequestHandlers(doc).find((h) => JSON.stringify(h.rewrite).includes('/api/forward-auth/verify'));
    expect(verify).toBeDefined();

    const denied = (verify!.handle_response as Array<{ match?: { status_code?: number[] }; routes?: Handler[] }>).find(
      (entry) => entry.match?.status_code?.includes(401)
    );
    expect(denied?.match?.status_code).toEqual([401, 403]);
    const routes = denied!.routes!;
    const location = (route: Handler) =>
      ((route.handle as Handler[])[0].headers as { Location: string[] }).Location[0];

    expect(routes).toHaveLength(2);
    expect(routes[0].match).toEqual([
      { not: [{ vars: { '{http.reverse_proxy.header.X-Cpm-Portal-Target}': [''] } }] },
    ]);
    expect(location(routes[0])).toMatch(/\/portal\?rd=\{http\.reverse_proxy\.header\.X-Cpm-Portal-Target\}$/);
    expect(routes[1].match).toBeUndefined();
    expect(location(routes[1])).toMatch(
      /\/portal\?rd=\{http\.request\.scheme\}:\/\/\{http\.request\.hostport\}\{http\.request\.uri_escaped\}$/
    );
    // The raw request URI is never placed in the portal query string.
    expect(JSON.stringify(doc)).not.toContain('{http.request.hostport}{http.request.uri}');
  });
});
