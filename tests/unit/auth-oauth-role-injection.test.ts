/**
 * Regression (SECURITY-AUDIT H3): an external OAuth identity provider must NOT
 * be able to set privileged user fields. better-auth's generic-OAuth signup
 * spreads the raw IdP profile claims into the new user record and bypasses the
 * `input:false` flags on `role`/`status`, so a permissive or attacker-controlled
 * IdP returning `role: "admin"` could self-provision an admin account.
 *
 * The fix forces role/status to safe defaults via a databaseHooks.user.create
 * .before hook (which fires on the OAuth createOAuthUser path). These tests lock
 * both the transform and the fact that the hook is actually wired into the
 * better-auth config.
 */
import { describe, it, expect, vi } from 'vitest';
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

// Stub better-auth so importing auth-server doesn't pull in the full runtime
// (which fails under vitest's module resolution). `betterAuth` returns the raw
// options object, so getAuth().options is exactly the config createAuth() built
// — including our real databaseHooks — which is what we want to assert on.
vi.mock('better-auth', () => ({
   
  betterAuth: (options: any) => ({ options }),
}));
vi.mock('better-auth/plugins', () => ({
  genericOAuth: () => ({}),
  username: () => ({}),
}));

import { enforceSafeUserDefaults, getAuth, mapOAuthProvider } from '../../src/lib/auth-server';
import type { OAuthProvider } from '../../src/lib/models/oauth-providers';

describe('enforceSafeUserDefaults', () => {
  it('forces role and status to safe defaults', () => {
    const out = enforceSafeUserDefaults({ email: 'x@y.z', name: 'X', role: 'admin', status: 'active' });
    expect(out.role).toBe('user');
    expect(out.status).toBe('active');
  });

  it('overrides malicious role/status injected via OAuth claims', () => {
    const out = enforceSafeUserDefaults({
      email: 'evil@idp.example',
      role: 'admin',
      status: 'whatever',
    } as Record<string, unknown>);
    expect(out.role).toBe('user');
    expect(out.status).toBe('active');
  });

  it('preserves non-privileged identity fields', () => {
    const out = enforceSafeUserDefaults({
      email: 'a@b.c',
      name: 'Alice',
      image: 'https://img.example/a.png',
      emailVerified: true,
    } as Record<string, unknown>) as Record<string, unknown>;
    expect(out.email).toBe('a@b.c');
    expect(out.name).toBe('Alice');
    expect(out.image).toBe('https://img.example/a.png');
    expect(out.emailVerified).toBe(true);
    expect(out.role).toBe('user');
  });
});

describe('better-auth user.create.before hook (wired into the real config)', () => {
  it('is configured as a function', () => {
     
    const auth = getAuth() as any;
    const hook = auth.options?.databaseHooks?.user?.create?.before;
    expect(typeof hook).toBe('function');
  });

  it('forces role/status to safe defaults on a malicious OAuth-style user create', async () => {
     
    const auth = getAuth() as any;
    const hook = auth.options.databaseHooks.user.create.before;

    const result = await hook({
      email: 'attacker@evil-idp.example',
      name: 'Mallory',
      role: 'admin', // injected by a hostile IdP
      status: 'active',
    });

    expect(result.data.role).toBe('user');
    expect(result.data.status).toBe('active');
    expect(result.data.email).toBe('attacker@evil-idp.example'); // identity preserved
  });
});

describe('mapOAuthProvider — OAuth self-registration gating (M2)', () => {
  const sampleProvider: OAuthProvider = {
    id: 'p1',
    name: 'Some IdP',
    type: 'oidc',
    clientId: 'cid',
    clientSecret: 'secret',
    issuer: 'https://idp.example/',
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    scopes: 'openid email profile',
    autoLink: false,
    enabled: true,
    source: 'ui',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('disables implicit signup by default (AUTH_ALLOW_OAUTH_REGISTRATION unset)', () => {
    // The test env does not set AUTH_ALLOW_OAUTH_REGISTRATION, so OAuth signup
    // must be closed: an unknown IdP identity cannot self-provision an account.
    const cfg = mapOAuthProvider(sampleProvider);
    expect(cfg.disableImplicitSignUp).toBe(true);
    // A client-sent `requestSignUp: true` overrides disableImplicitSignUp in
    // Better Auth; disableSignUp is the flag it cannot override.
    expect(cfg.disableSignUp).toBe(true);
  });

  it('uses the Better Auth 1.7.4 config shape: providerId is the config-pinned namespace', () => {
    const cfg = mapOAuthProvider(sampleProvider);

    // In Better Auth 1.7.4 the OAuth account key is (providerId, accountId):
    // the account namespace comes from the always-config-pinned providerId,
    // so the `accountIssuer` option was removed. Discovery still derives from
    // the configured issuer, and the provider namespace is never a claim.
    expect(cfg.providerId).toBe('p1');
    expect(cfg.discoveryUrl).toBe('https://idp.example/.well-known/openid-configuration');
    expect(cfg).not.toHaveProperty('issuer');
    expect(cfg).not.toHaveProperty('accountIssuer');
  });

  it('keeps issuerless OAuth providers namespace-isolated via providerId', () => {
    const cfg = mapOAuthProvider({
      ...sampleProvider,
      id: 'team/provider',
      issuer: null,
      authorizationUrl: 'https://idp.example/authorize',
      tokenUrl: 'https://idp.example/token',
    });

    expect(cfg.providerId).toBe('team/provider');
    expect(cfg).not.toHaveProperty('accountIssuer');
  });
});

describe('better-auth account.create.before hook — pins the CPM issuer namespace', () => {
  // Better Auth 1.7.4 removed `issuer` from the account schema and keys
  // external identities by (providerId, accountId). CPM keeps a NOT NULL
  // `accounts.issuer` column for its own identity bookkeeping, and derives it
  // here before insert so the credential and OAuth namespaces stay isolated.
  it('is configured as a function', () => {
    const auth = getAuth() as any;
    expect(typeof auth.options?.databaseHooks?.account?.create?.before).toBe('function');
  });

  it('stamps the credential namespace onto local password accounts', async () => {
    const auth = getAuth() as any;
    const hook = auth.options.databaseHooks.account.create.before;

    const result = await hook({ userId: '1', providerId: 'credential', accountId: '1' });

    expect(result.data.issuer).toBe('local:credential');
  });

  it('stamps an encoded synthetic OAuth namespace for issuerless providers', async () => {
    const auth = getAuth() as any;
    const hook = auth.options.databaseHooks.account.create.before;

    const result = await hook({ userId: '2', providerId: 'team/provider', accountId: 'abc' });

    expect(result.data.issuer).toBe('local:oauth:team%2Fprovider');
  });

  it('pins a configured provider to its operator-set issuer', async () => {
    const { oauthProviders } = await import('../../src/lib/db/schema');
    const db = (await import('../../src/lib/db')).default;
    const NOW = '2026-01-01T00:00:00.000Z';
    await db.insert(oauthProviders).values({
      id: 'p1',
      name: 'Some IdP',
      type: 'oidc',
      clientId: 'cid',
      clientSecret: 'secret',
      issuer: 'https://idp.example/',
      scopes: 'openid email profile',
      autoLink: true,
      enabled: true,
      source: 'ui',
      createdAt: NOW,
      updatedAt: NOW,
    }).run();

    const auth = getAuth() as any;
    const hook = auth.options.databaseHooks.account.create.before;
    const result = await hook({ userId: '3', providerId: 'p1', accountId: 'sub-123' });

    expect(result.data.issuer).toBe('https://idp.example/');
  });
});
