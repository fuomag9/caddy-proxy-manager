/**
 * Regression coverage for CPM-API-001.
 *
 * A code disclosed to another wildcard subdomain (or another scheme/port on
 * the same hostname) must not be redeemable there, and a token issued for one
 * exact origin must never become a global forward-auth bearer credential.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

// Non-default external ports must be declared explicitly; these tests use two.
process.env.FORWARD_AUTH_ALLOWED_PORTS = '8443, 9443';

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

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

// Keep the real config builder so the proof-header wiring is covered, while
// preventing any accidental live Caddy apply from this integration test.
vi.mock('../../src/lib/caddy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/caddy')>();
  return { ...actual, applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) };
});

import * as schema from '../../src/lib/db/schema';
import {
  createExchangeCode,
  createForwardAuthSession,
  createRedirectIntent,
  redeemExchangeCode,
  resolveForwardAuthAudience,
  validateForwardAuthSession,
} from '../../src/lib/models/forward-auth';
import { GET as forwardAuthCallback } from '../../app/api/forward-auth/callback/route';
import {
  FORWARD_AUTH_PROXY_HOST_ID_HEADER,
  FORWARD_AUTH_PROXY_PROOF_HEADER,
  getForwardAuthProxyProof,
  getTrustedForwardAuthOrigin,
} from '../../src/lib/forward-auth-trust';
import { buildCaddyDocument } from '../../src/lib/caddy';

const now = () => new Date().toISOString();

async function insertUser() {
  const timestamp = now();
  const [user] = await ctx.db.insert(schema.users).values({
    email: 'alice@localhost',
    name: 'Alice',
    role: 'user',
    provider: 'credentials',
    subject: 'alice',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  return user;
}

async function insertWildcardHost() {
  const timestamp = now();
  const [host] = await ctx.db.insert(schema.proxyHosts).values({
    name: 'Wildcard apps',
    domains: JSON.stringify(['*.example.com']),
    upstreams: JSON.stringify(['backend:8080']),
    sslForced: true,
    hstsEnabled: true,
    hstsSubdomains: false,
    allowWebsocket: true,
    preserveHostHeader: true,
    skipHttpsHostnameValidation: false,
    enabled: true,
    meta: JSON.stringify({ cpm_forward_auth: { enabled: true } }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  return host;
}

async function setupAuthorizedWildcard() {
  const user = await insertUser();
  const host = await insertWildcardHost();
  await ctx.db.insert(schema.forwardAuthAccess).values({
    proxyHostId: host.id,
    userId: user.id,
    groupId: null,
    createdAt: now(),
  });
  return { user, host };
}

function proxyHeaders(origin: string, proof = getForwardAuthProxyProof(), proxyHostId?: number): HeadersInit {
  const target = new URL(origin);
  return {
    'x-forwarded-proto': target.protocol.slice(0, -1),
    'x-forwarded-host': target.host,
    [FORWARD_AUTH_PROXY_PROOF_HEADER]: proof,
    ...(proxyHostId !== undefined ? { [FORWARD_AUTH_PROXY_HOST_ID_HEADER]: String(proxyHostId) } : {}),
  };
}

function rawProxyHeaders(proto: string, rawHost: string, proxyHostId?: number): HeadersInit {
  return {
    'x-forwarded-proto': proto,
    'x-forwarded-host': rawHost,
    [FORWARD_AUTH_PROXY_PROOF_HEADER]: getForwardAuthProxyProof(),
    ...(proxyHostId !== undefined ? { [FORWARD_AUTH_PROXY_HOST_ID_HEADER]: String(proxyHostId) } : {}),
  };
}

async function insertExactHost(domain: string) {
  const timestamp = now();
  const [host] = await ctx.db.insert(schema.proxyHosts).values({
    name: `Exact ${domain}`,
    domains: JSON.stringify([domain]),
    upstreams: JSON.stringify(['backend2:8080']),
    sslForced: true,
    hstsEnabled: true,
    hstsSubdomains: false,
    allowWebsocket: true,
    preserveHostHeader: true,
    skipHttpsHostnameValidation: false,
    enabled: true,
    meta: JSON.stringify({ cpm_forward_auth: { enabled: true } }),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning();
  return host;
}

async function createCode(userId: number, target: string) {
  const rid = await createRedirectIntent(target);
  const intent = await (await import('../../src/lib/models/forward-auth')).consumeRedirectIntent(rid);
  if (!intent) throw new Error('test redirect intent was not created');
  const { session } = await createForwardAuthSession(userId, intent.audience);
  const { rawCode } = await createExchangeCode(session.id, intent.redirectUri, intent.audience);
  return { rawCode, audience: intent.audience };
}

beforeEach(async () => {
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users);
});

describe('forward-auth exact audience binding', () => {
  it('persists the concrete wildcard origin and proxy host in every credential stage', async () => {
    const { user, host } = await setupAuthorizedWildcard();
    const target = 'https://private.example.com:8443/deep/path?x=1';

    const rid = await createRedirectIntent(target);
    const [storedIntent] = await ctx.db.select().from(schema.forwardAuthRedirectIntents);
    expect(storedIntent).toMatchObject({
      proxyHostId: host.id,
      audienceOrigin: 'https://private.example.com:8443',
      redirectUri: target,
    });

    const { consumeRedirectIntent } = await import('../../src/lib/models/forward-auth');
    const intent = await consumeRedirectIntent(rid);
    expect(intent?.audience).toEqual({
      proxyHostId: host.id,
      origin: 'https://private.example.com:8443',
      hostname: 'private.example.com',
    });

    const { rawToken, session } = await createForwardAuthSession(user.id, intent!.audience);
    expect(session).toMatchObject({
      proxyHostId: host.id,
      audienceOrigin: 'https://private.example.com:8443',
    });
    await expect(validateForwardAuthSession(rawToken, intent!.audience)).resolves.toEqual({
      sessionId: session.id,
      userId: user.id,
    });

    await createExchangeCode(session.id, target, intent!.audience);
    const [exchange] = await ctx.db.select().from(schema.forwardAuthExchanges);
    expect(exchange).toMatchObject({
      proxyHostId: host.id,
      audienceOrigin: 'https://private.example.com:8443',
    });
  });

  it.each([
    ['another wildcard hostname', 'https://evil.example.com'],
    ['another port', 'https://private.example.com:9443'],
    ['another scheme', 'http://private.example.com:8443'],
  ])('does not consume a code at %s', async (_caseName, wrongOrigin) => {
    const { user } = await setupAuthorizedWildcard();
    const target = 'https://private.example.com:8443/account';
    const { rawCode, audience } = await createCode(user.id, target);
    const wrongAudience = await resolveForwardAuthAudience(wrongOrigin);
    expect(wrongAudience).not.toBeNull();

    await expect(redeemExchangeCode(rawCode, wrongAudience!)).resolves.toBeNull();
    const [stillValid] = await ctx.db.select().from(schema.forwardAuthExchanges);
    expect(stillValid.used).toBe(false);

    const redeemed = await redeemExchangeCode(rawCode, audience);
    expect(redeemed?.redirectUri).toBe(target);
  });

  it('scopes the resulting session token to the exact origin', async () => {
    const { user } = await setupAuthorizedWildcard();
    const target = 'https://private.example.com/profile';
    const { rawCode, audience } = await createCode(user.id, target);
    const redeemed = await redeemExchangeCode(rawCode, audience);
    expect(redeemed).not.toBeNull();

    const siblingAudience = await resolveForwardAuthAudience('https://other.example.com');
    await expect(
      validateForwardAuthSession(redeemed!.rawSessionToken, siblingAudience!),
    ).resolves.toBeNull();
    await expect(
      validateForwardAuthSession(redeemed!.rawSessionToken, audience),
    ).resolves.toEqual({ sessionId: redeemed!.sessionId, userId: user.id });
  });
});

describe('trusted Caddy callback boundary', () => {
  it('rejects direct-origin requests even when forwarded host/protocol are forged', async () => {
    const { user } = await setupAuthorizedWildcard();
    const { rawCode } = await createCode(user.id, 'https://private.example.com/');

    const directRequest = new NextRequest(`http://localhost:3000/api/forward-auth/callback?code=${rawCode}`, {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'private.example.com',
      },
    });
    const response = await forwardAuthCallback(directRequest);
    expect(response.status).toBe(401);

    const [exchange] = await ctx.db.select().from(schema.forwardAuthExchanges);
    expect(exchange.used).toBe(false);
  });

  it('rejects a disclosed code at a different Caddy-served wildcard origin without consuming it', async () => {
    const { user, host } = await setupAuthorizedWildcard();
    const target = 'https://private.example.com/dashboard';
    const { rawCode } = await createCode(user.id, target);

    const attackerRequest = new NextRequest(`http://localhost/api/forward-auth/callback?code=${rawCode}`, {
      headers: proxyHeaders('https://evil.example.com', undefined, host.id),
    });
    expect((await forwardAuthCallback(attackerRequest)).status).toBe(401);

    const legitimateRequest = new NextRequest(`http://localhost/api/forward-auth/callback?code=${rawCode}`, {
      headers: proxyHeaders('https://private.example.com', undefined, host.id),
    });
    const response = await forwardAuthCallback(legitimateRequest);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(target);
    expect(response.headers.get('set-cookie')).toContain('_cpm_fa=');
  });

  it('rejects malformed or forged proxy proofs using a timing-safe fixed-length check', () => {
    expect(getTrustedForwardAuthOrigin(new Headers(proxyHeaders('https://private.example.com', '0'.repeat(64))))).toBeNull();
    expect(getTrustedForwardAuthOrigin(new Headers(proxyHeaders('https://private.example.com', 'short')))).toBeNull();
    expect(getTrustedForwardAuthOrigin(new Headers(proxyHeaders('https://private.example.com:8443')))).toBe(
      'https://private.example.com:8443',
    );
  });

  it('injects the proof into both generated Caddy subrequests', async () => {
    await setupAuthorizedWildcard();
    const document = await buildCaddyDocument();
    const reverseProxies: Array<Record<string, unknown>> = [];

    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        if (object.handler === 'reverse_proxy') reverseProxies.push(object);
        Object.values(object).forEach(visit);
      }
    };
    visit(document);

    const securityRoutes = reverseProxies.filter((proxy) => {
      const uri = (proxy.rewrite as { uri?: string } | undefined)?.uri ?? '';
      return uri.includes('/api/forward-auth/verify') || uri.includes('/api/forward-auth/callback');
    });
    expect(securityRoutes.length).toBeGreaterThanOrEqual(2);
    for (const proxy of securityRoutes) {
      const set = (proxy.headers as { request?: { set?: Record<string, string[]> } } | undefined)?.request?.set;
      expect(set?.[FORWARD_AUTH_PROXY_PROOF_HEADER]).toEqual([getForwardAuthProxyProof()]);
      expect(set?.['X-Forwarded-Host']).toEqual(['{http.request.hostport}']);
    }

    // Caddy's `host` placeholder intentionally omits the port. The audience
    // and redirect handoff must use `hostport` so legitimate :8443 origins
    // survive the generated configuration unchanged.
    const serialized = JSON.stringify(document);
    expect(serialized).toContain(
      '://{http.request.hostport}{http.request.uri}'
    );
  });
});

describe('forwarded host must match the route Caddy chose', () => {
  it.each([
    ['percent-encoded label', '%61pp.example.com'],
    ['percent-encoded dot', 'x%2eapp.example.com'],
    ['raw UTF-8 bytes', '\xEF\xBD\x81pp.example.com'],
    ['percent-encoded UTF-8', '%EF%BD%81pp.example.com'],
    ['IPv4 shorthand', '127.1'],
    ['multiple values', 'app.example.com, evil.example.com'],
  ])('rejects a %s', (_caseName, rawHost) => {
    expect(getTrustedForwardAuthOrigin(new Headers(rawProxyHeaders('https', rawHost) as Record<string, string>))).toBeNull();
  });

  it('accepts a plain hostname regardless of case', () => {
    expect(getTrustedForwardAuthOrigin(new Headers(rawProxyHeaders('https', 'App.Example.com')))).toBe(
      'https://app.example.com',
    );
  });

  it('refuses a callback whose origin resolves to a different proxy host than the pinned route', async () => {
    const { user, host: wildcard } = await setupAuthorizedWildcard();
    const exact = await insertExactHost('app.example.com');
    await ctx.db.insert(schema.forwardAuthAccess).values({
      proxyHostId: exact.id, userId: user.id, groupId: null, createdAt: now(),
    });
    const target = 'https://app.example.com/';
    const { rawCode } = await createCode(user.id, target);

    // Routed through the wildcard host's Caddy route, but claiming the exact host.
    const crossRouted = new NextRequest(`http://localhost/api/forward-auth/callback?code=${rawCode}`, {
      headers: proxyHeaders('https://app.example.com', undefined, wildcard.id),
    });
    expect((await forwardAuthCallback(crossRouted)).status).toBe(401);

    const unpinned = new NextRequest(`http://localhost/api/forward-auth/callback?code=${rawCode}`, {
      headers: proxyHeaders('https://app.example.com'),
    });
    expect((await forwardAuthCallback(unpinned)).status).toBe(401);

    const [exchange] = await ctx.db.select().from(schema.forwardAuthExchanges);
    expect(exchange.used).toBe(false);

    const legitimate = new NextRequest(`http://localhost/api/forward-auth/callback?code=${rawCode}`, {
      headers: proxyHeaders('https://app.example.com', undefined, exact.id),
    });
    expect((await forwardAuthCallback(legitimate)).status).toBe(302);
  });

  it('pins each generated subrequest to its own proxy host id', async () => {
    const { host } = await setupAuthorizedWildcard();
    const serialized = JSON.stringify(await buildCaddyDocument());
    expect(serialized).toContain(`"${FORWARD_AUTH_PROXY_HOST_ID_HEADER}":["${host.id}"]`);
  });
});

describe('non-default forward-auth ports', () => {
  it('rejects redirect targets on undeclared ports', async () => {
    await setupAuthorizedWildcard();
    await expect(resolveForwardAuthAudience('https://private.example.com:9999')).resolves.toBeNull();
    await expect(createRedirectIntent('https://private.example.com:9999/')).rejects.toThrow();
    await expect(resolveForwardAuthAudience('https://private.example.com:8443')).resolves.not.toBeNull();
    await expect(resolveForwardAuthAudience('https://private.example.com:443')).resolves.not.toBeNull();
  });
});
