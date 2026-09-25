/**
 * Regression (#247): OAuth/OIDC sign-in succeeded but linking the identity to
 * an existing CPM account always failed with `account_not_linked`.
 *
 * Two things were missing. Better Auth was never given an `account
 * .accountLinking` configuration, so its default gate refused every link (CPM
 * has no local email-verification flow, so `requireLocalEmailVerified` could
 * never be satisfied), and the per-provider `autoLink` switch was stored but
 * never reached the auth config. These tests lock the wiring in both
 * directions: auto-link providers are trusted, and providers without it stay
 * unable to claim an existing account.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();

  const now = '2026-01-01T00:00:00.000Z';
  ctx.db.insert(schemaModule.oauthProviders).values([
    {
      id: 'autolink-idp',
      name: 'Auto-link IdP',
      type: 'oidc',
      clientId: 'cid-a',
      clientSecret: 'secret-a',
      issuer: 'https://autolink.example',
      scopes: 'openid email profile',
      autoLink: true,
      enabled: true,
      source: 'ui',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'manual-idp',
      name: 'Manual IdP',
      type: 'oidc',
      clientId: 'cid-b',
      clientSecret: 'secret-b',
      issuer: 'https://manual.example',
      scopes: 'openid email profile',
      autoLink: false,
      enabled: true,
      source: 'ui',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'disabled-idp',
      name: 'Disabled IdP',
      type: 'oidc',
      clientId: 'cid-c',
      clientSecret: 'secret-c',
      issuer: 'https://disabled.example',
      scopes: 'openid email profile',
      autoLink: true,
      enabled: false,
      source: 'ui',
      createdAt: now,
      updatedAt: now,
    },
  ]).run();

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

// Stub better-auth so `betterAuth(options)` hands back the raw options object;
// getAuth().options is then exactly the config createAuth() assembled.
vi.mock('better-auth', () => ({

  betterAuth: (options: any) => ({ options }),
}));
vi.mock('better-auth/plugins', () => ({
  genericOAuth: () => ({}),
  username: () => ({}),
}));

import { getAuth, mapOAuthProvider } from '../../src/lib/auth-server';
import type { OAuthProvider } from '../../src/lib/models/oauth-providers';

const baseProvider: OAuthProvider = {
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


async function mapProfile(provider: OAuthProvider, profile: Record<string, unknown>): Promise<any> {
  const mapper = mapOAuthProvider(provider).mapProfileToUser;
  expect(typeof mapper).toBe('function');

  return await mapper!(profile as any);
}

describe('mapOAuthProvider — email_verified claim mapping', () => {
  it('reports the OIDC claim for an auto-link provider', async () => {
    const mapped = await mapProfile(
      { ...baseProvider, autoLink: true },
      { email: 'user@example.com', email_verified: true }
    );
    expect(mapped.emailVerified).toBe(true);
  });

  it('accepts a string-encoded claim from providers that serialize it that way', async () => {
    const mapped = await mapProfile(
      { ...baseProvider, autoLink: true },
      { email: 'user@example.com', email_verified: 'true' }
    );
    expect(mapped.emailVerified).toBe(true);
  });

  it('reports false when an auto-link provider does not verify the email', async () => {
    const mapped = await mapProfile(
      { ...baseProvider, autoLink: true },
      { email: 'user@example.com' }
    );
    expect(mapped.emailVerified).toBe(false);
  });

  it('never lets a provider without auto-link assert a verified email', async () => {
    const mapped = await mapProfile(
      { ...baseProvider, autoLink: false },
      { email: 'victim@example.com', email_verified: true }
    );
    expect(mapped.emailVerified).toBe(false);
  });

  it('leaves identity fields to Better Auth rather than overriding them', async () => {
    const mapped = await mapProfile(
      { ...baseProvider, autoLink: true },
      { email: 'user@example.com', email_verified: true, name: 'User', role: 'admin' }
    );
    expect(Object.keys(mapped)).toEqual(['emailVerified']);
  });
});

describe('better-auth account.accountLinking (wired into the real config)', () => {

  const options = (getAuth() as any).options;

  it('enables account linking', () => {
    expect(options.account.accountLinking.enabled).toBe(true);
  });

  it('does not gate on a local emailVerified flag CPM can never set', () => {
    // CPM has no email-verification flow, so the Better Auth default of `true`
    // refuses every link regardless of provider trust — the #247 symptom.
    expect(options.account.accountLinking.requireLocalEmailVerified).toBe(false);
  });

  it('trusts exactly the enabled providers with auto-link turned on', () => {
    expect(options.account.accountLinking.trustedProviders).toEqual(['autolink-idp']);
  });

  it('does not implicitly disable linking', () => {
    expect(options.account.accountLinking.disableImplicitLinking).toBeUndefined();
  });
});

describe('better-auth self-service endpoints', () => {
  const options = (getAuth() as any).options;

  it.each([
    '/update-user',
    '/change-password',
    '/change-email',
    '/delete-user',
    '/unlink-account',
    '/update-session',
    '/verify-password',
    '/is-username-available',
  ])('disables %s (CPM routes own these changes)', (path) => {
    expect(options.disabledPaths).toContain(path);
  });

  it('keeps the endpoints the UI relies on', () => {
    for (const path of ['/sign-in/username', '/sign-in/social', '/link-social', '/get-session', '/sign-out']) {
      expect(options.disabledPaths).not.toContain(path);
    }
  });
});
