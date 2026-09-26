/**
 * reencryptStoredSecrets moves every stored encryptSecret value that only an
 * old key decrypts (SESSION_SECRET_PREVIOUS or a rejected placeholder secret)
 * onto the current SESSION_SECRET, so a rotation needs no manual re-entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({
  db: null as unknown as TestDb,
  config: {
    sessionSecret: 'current-secret-for-rotation-tests-0123456789',
    previousSessionSecrets: [] as string[],
  },
}));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    sqlite: undefined,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
  };
});
vi.mock('../../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/config')>()),
  config: ctx.config,
}));

import * as schema from '../../src/lib/db/schema';
import { decryptSecret, encryptSecret, reencryptSecret } from '../../src/lib/secret';
import { reencryptStoredSecrets } from '../../src/lib/secret-rotation';
import { getCloudflareSettings, saveCloudflareSettings } from '../../src/lib/settings';

const PLACEHOLDER_SECRET = 'your-secure-session-secret-here-min-32-chars';
const OLD_SECRET = 'old-operator-secret-abcdefghijklmnopqrstuvwxyz';
const NEW_SECRET = 'new-operator-secret-zyxwvutsrqponmlkjihgfedcba';

const PLAINTEXT = {
  accessToken: 'oauth-access-token',
  refreshToken: 'oauth-refresh-token',
  idToken: 'oauth-id-token',
  clientId: 'provider-client-id',
  clientSecret: 'provider-client-secret',
  certificateKey: '-----BEGIN PRIVATE KEY-----\ncert\n-----END PRIVATE KEY-----',
  caKey: '-----BEGIN PRIVATE KEY-----\nca\n-----END PRIVATE KEY-----',
  instanceToken: 'instance-api-token-0123456789abcdef',
  dnsToken: 'cloudflare-api-token',
  masterToken: 'master-sync-token-0123456789abcdef',
};
const STORED_VALUE_COUNT = Object.keys(PLAINTEXT).length;
/** accessToken, refreshToken and idToken of the seeded OAuth account. */
const OAUTH_TOKEN_COUNT = 3;

function useSecret(secret: string, previous: string[] = []) {
  ctx.config.sessionSecret = secret;
  ctx.config.previousSessionSecrets = previous;
}

/** Store one encrypted value in every place that holds encryptSecret output. */
async function seedStoredSecrets() {
  const now = new Date().toISOString();
  const db = ctx.db;
  const [user] = await db.insert(schema.users).values({
    email: 'user@example.com', role: 'user', status: 'active', createdAt: now, updatedAt: now,
  }).returning();
  await db.insert(schema.accounts).values({
    userId: user.id, issuer: 'https://idp.example.com', accountId: 'sub-1', providerId: 'oidc',
    accessToken: encryptSecret(PLAINTEXT.accessToken),
    refreshToken: encryptSecret(PLAINTEXT.refreshToken),
    idToken: encryptSecret(PLAINTEXT.idToken),
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.oauthProviders).values({
    id: 'oidc', name: 'OIDC', type: 'oidc',
    clientId: encryptSecret(PLAINTEXT.clientId),
    clientSecret: encryptSecret(PLAINTEXT.clientSecret),
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.certificates).values({
    name: 'imported', type: 'imported', domainNames: '["app.example.com"]',
    certificatePem: 'cert', privateKeyPem: encryptSecret(PLAINTEXT.certificateKey),
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.caCertificates).values({
    name: 'client CA', certificatePem: 'ca', privateKeyPem: encryptSecret(PLAINTEXT.caKey),
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.instances).values({
    name: 'slave', baseUrl: 'https://slave.example.com', apiToken: encryptSecret(PLAINTEXT.instanceToken),
    createdAt: now, updatedAt: now,
  });
  await db.insert(schema.settings).values([
    {
      key: 'dns_provider',
      value: JSON.stringify({
        providers: { cloudflare: { api_token: encryptSecret(PLAINTEXT.dnsToken), zone: 'example.com' } },
        default: 'cloudflare',
      }),
      updatedAt: now,
    },
    { key: 'instance_master_token', value: JSON.stringify(encryptSecret(PLAINTEXT.masterToken)), updatedAt: now },
    { key: 'general', value: JSON.stringify({ primaryDomain: 'example.com' }), updatedAt: now },
  ]);
}

/** Every stored encrypted value, keyed like PLAINTEXT. */
async function readStoredSecrets(): Promise<Record<keyof typeof PLAINTEXT, string>> {
  const db = ctx.db;
  const account = (await db.select().from(schema.accounts).get())!;
  const provider = (await db.select().from(schema.oauthProviders).get())!;
  const certificate = (await db.select().from(schema.certificates).get())!;
  const ca = (await db.select().from(schema.caCertificates).get())!;
  const instance = (await db.select().from(schema.instances).get())!;
  const settingValue = async (key: string) =>
    JSON.parse((await db.select().from(schema.settings).all()).find((row) => row.key === key)!.value);
  const dnsProvider = await settingValue('dns_provider');
  return {
    accessToken: account.accessToken!,
    refreshToken: account.refreshToken!,
    idToken: account.idToken!,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    certificateKey: certificate.privateKeyPem!,
    caKey: ca.privateKeyPem!,
    instanceToken: instance.apiToken,
    dnsToken: dnsProvider.providers.cloudflare.api_token,
    masterToken: await settingValue('instance_master_token'),
  };
}

/** Values the current key decrypts on its own, with the expected plaintext. */
async function expectAllUnderCurrentKey() {
  const stored = await readStoredSecrets();
  for (const [name, value] of Object.entries(stored)) {
    expect(reencryptSecret(value), name).toBeNull();
    expect(decryptSecret(value), name).toBe(PLAINTEXT[name as keyof typeof PLAINTEXT]);
  }
}

beforeEach(async () => {
  for (const table of [
    schema.accounts, schema.users, schema.oauthProviders, schema.certificates,
    schema.caCertificates, schema.instances, schema.settings,
  ]) {
    await ctx.db.delete(table);
  }
  useSecret(NEW_SECRET);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Everything reencryptStoredSecrets passed to console.warn, as one string. */
function spyOnWarnings(): () => string {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
}

describe('reencryptStoredSecrets', () => {
  it('re-encrypts values stored under the old placeholder secret after switching to a new one', async () => {
    useSecret(PLACEHOLDER_SECRET);
    await seedStoredSecrets();
    const before = await readStoredSecrets();

    useSecret(NEW_SECRET);
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: STORED_VALUE_COUNT, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });

    const after = await readStoredSecrets();
    for (const name of Object.keys(PLAINTEXT) as (keyof typeof PLAINTEXT)[]) {
      expect(after[name], name).not.toBe(before[name]);
    }
    await expectAllUnderCurrentKey();

    // Unrelated settings and non-secret fields are untouched.
    const rows = await ctx.db.select().from(schema.settings).all();
    expect(JSON.parse(rows.find((row) => row.key === 'general')!.value)).toEqual({ primaryDomain: 'example.com' });
    expect(JSON.parse(rows.find((row) => row.key === 'dns_provider')!.value).providers.cloudflare.zone).toBe('example.com');
  });

  it('re-encrypts values stored under SESSION_SECRET_PREVIOUS', async () => {
    useSecret(OLD_SECRET);
    await seedStoredSecrets();

    useSecret(NEW_SECRET, ['another-old-secret-0000000000000000000000', OLD_SECRET]);
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: STORED_VALUE_COUNT, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });

    // The previous secret is no longer needed.
    useSecret(NEW_SECRET);
    await expectAllUnderCurrentKey();
  });

  it('leaves values it cannot decrypt unchanged and counts them, without throwing', async () => {
    useSecret(OLD_SECRET);
    await seedStoredSecrets();
    const before = await readStoredSecrets();

    useSecret(NEW_SECRET);
    const warnings = spyOnWarnings();
    expect(await reencryptStoredSecrets()).toEqual({
      reencrypted: 0,
      encryptedPlaintext: 0,
      failed: STORED_VALUE_COUNT - OAUTH_TOKEN_COUNT,
      clearedOAuthTokens: OAUTH_TOKEN_COUNT,
    });
    // OAuth account tokens are cleared instead (see below); the rest is kept.
    expect(await readStoredSecrets()).toEqual({ ...before, accessToken: null, refreshToken: null, idToken: null });
    expect(warnings()).toContain('OAuth provider oidc clientSecret cannot be decrypted');
    expect(warnings()).toContain('setting "dns_provider" cannot be decrypted');

    // Supplying the old secret on a later start recovers them.
    useSecret(NEW_SECRET, [OLD_SECRET]);
    expect(await reencryptStoredSecrets()).toEqual({
      reencrypted: STORED_VALUE_COUNT - OAUTH_TOKEN_COUNT,
      encryptedPlaintext: 0,
      failed: 0,
      clearedOAuthTokens: 0,
    });
  });

  it('clears OAuth account tokens that no key decrypts, without counting or reporting each one', async () => {
    useSecret(OLD_SECRET);
    await seedStoredSecrets();
    // One token still decrypts (placeholder key); the other two do not.
    useSecret(PLACEHOLDER_SECRET);
    await ctx.db.update(schema.accounts).set({ idToken: encryptSecret(PLAINTEXT.idToken) });

    useSecret(NEW_SECRET);
    const warnings = spyOnWarnings();
    const result = await reencryptStoredSecrets();
    expect(result).toMatchObject({ clearedOAuthTokens: 2, failed: STORED_VALUE_COUNT - OAUTH_TOKEN_COUNT });
    expect(warnings()).not.toContain('OAuth account');

    const account = (await ctx.db.select().from(schema.accounts).get())!;
    expect(account).toMatchObject({ accountId: 'sub-1', accessToken: null, refreshToken: null });
    expect(reencryptSecret(account.idToken!)).toBeNull();
    expect(decryptSecret(account.idToken!)).toBe(PLAINTEXT.idToken);

    // Nothing is left to clear on the next start.
    expect(await reencryptStoredSecrets()).toMatchObject({ clearedOAuthTokens: 0, reencrypted: 0 });
  });

  it('does nothing when every value already uses the current key', async () => {
    useSecret(NEW_SECRET, [OLD_SECRET]);
    await seedStoredSecrets();
    const before = await readStoredSecrets();
    const settingsBefore = await ctx.db.select().from(schema.settings).all();

    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });
    expect(await readStoredSecrets()).toEqual(before);
    expect(await ctx.db.select().from(schema.settings).all()).toEqual(settingsBefore);
  });

  it('is idempotent', async () => {
    useSecret(PLACEHOLDER_SECRET);
    await seedStoredSecrets();

    useSecret(NEW_SECRET);
    expect((await reencryptStoredSecrets()).reencrypted).toBe(STORED_VALUE_COUNT);
    const once = await readStoredSecrets();
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });
    expect(await readStoredSecrets()).toEqual(once);
  });

  it("re-encrypts a slave's synced:* settings, which a sync stores under the slave's key", async () => {
    useSecret(OLD_SECRET);
    await ctx.db.insert(schema.settings).values({
      key: 'synced:dns_provider',
      value: JSON.stringify({ providers: { cloudflare: { api_token: encryptSecret('synced-token') } }, default: 'cloudflare' }),
      updatedAt: new Date().toISOString(),
    });

    useSecret(NEW_SECRET, [OLD_SECRET]);
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 1, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });

    useSecret(NEW_SECRET);
    const row = (await ctx.db.select().from(schema.settings).all()).find((r) => r.key === 'synced:dns_provider')!;
    const token = JSON.parse(row.value).providers.cloudflare.api_token;
    expect(reencryptSecret(token)).toBeNull();
    expect(decryptSecret(token)).toBe('synced-token');
  });

  it("leaves synced:* values no key decrypts (an older master's own ciphertext) as sent, without reporting them", async () => {
    useSecret('secret-of-an-older-master-0123456789abcdef');
    const synced = JSON.stringify({ providers: { cloudflare: { api_token: encryptSecret('master-token') } } });
    await ctx.db.insert(schema.settings).values({
      key: 'synced:dns_provider', value: synced, updatedAt: new Date().toISOString(),
    });

    useSecret(NEW_SECRET, [OLD_SECRET]);
    const warnings = spyOnWarnings();
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });
    expect(warnings()).toBe('');
    const row = (await ctx.db.select().from(schema.settings).all()).find((r) => r.key === 'synced:dns_provider')!;
    expect(row.value).toBe(synced);
  });

  it('encrypts DNS provider password fields stored in plaintext, locally and in synced settings', async () => {
    // The REST API and the legacy Cloudflare migration store credentials as given.
    const now = new Date().toISOString();
    await ctx.db.insert(schema.settings).values([
      {
        key: 'dns_provider',
        value: JSON.stringify({
          providers: {
            cloudflare: { api_token: 'plain-cloudflare-token' },
            route53: { access_key_id: 'AKIAEXAMPLE', secret_access_key: 'plain-route53-secret', region: 'eu-west-1' },
          },
          default: 'cloudflare',
        }),
        updatedAt: now,
      },
      {
        key: 'synced:dns_provider',
        value: JSON.stringify({ provider: 'cloudflare', credentials: { api_token: 'plain-synced-token' } }),
        updatedAt: now,
      },
    ]);
    const warnings = spyOnWarnings();

    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 3, failed: 0, clearedOAuthTokens: 0 });
    expect(warnings()).toBe('');

    const setting = async (key: string) =>
      JSON.parse((await ctx.db.select().from(schema.settings).all()).find((row) => row.key === key)!.value);
    const local = await setting('dns_provider');
    expect(decryptSecret(local.providers.cloudflare.api_token)).toBe('plain-cloudflare-token');
    expect(decryptSecret(local.providers.route53.secret_access_key)).toBe('plain-route53-secret');
    expect(local.providers.route53).toMatchObject({ access_key_id: 'AKIAEXAMPLE', region: 'eu-west-1' });
    expect(local.default).toBe('cloudflare');
    const synced = await setting('synced:dns_provider');
    expect(synced.provider).toBe('cloudflare');
    expect(decryptSecret(synced.credentials.api_token)).toBe('plain-synced-token');
    expect(JSON.stringify([local, synced])).not.toContain('plain-');

    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });
  });

  it('encrypts the legacy Cloudflare API token stored in plaintext, locally and in synced settings', async () => {
    const now = new Date().toISOString();
    await ctx.db.insert(schema.settings).values([
      { key: 'cloudflare', value: JSON.stringify({ apiToken: 'plain-legacy-token', zoneId: 'zone-1' }), updatedAt: now },
      { key: 'synced:cloudflare', value: JSON.stringify({ apiToken: 'plain-synced-legacy-token' }), updatedAt: now },
    ]);

    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 2, failed: 0, clearedOAuthTokens: 0 });

    const rows = await ctx.db.select().from(schema.settings).all();
    const setting = (key: string) => JSON.parse(rows.find((row) => row.key === key)!.value);
    expect(decryptSecret(setting('cloudflare').apiToken)).toBe('plain-legacy-token');
    expect(setting('cloudflare').zoneId).toBe('zone-1');
    expect(decryptSecret(setting('synced:cloudflare').apiToken)).toBe('plain-synced-legacy-token');
    expect(await reencryptStoredSecrets()).toEqual({ reencrypted: 0, encryptedPlaintext: 0, failed: 0, clearedOAuthTokens: 0 });
  });

  it('stores a newly saved legacy Cloudflare API token encrypted', async () => {
    await saveCloudflareSettings({ apiToken: 'new-legacy-token', accountId: 'acct-1' });
    const stored = await getCloudflareSettings();
    expect(stored?.apiToken).not.toBe('new-legacy-token');
    expect(decryptSecret(stored!.apiToken)).toBe('new-legacy-token');
    expect(stored?.accountId).toBe('acct-1');
    // Saving the stored value again (the dashboard keeps the current token) does not re-encrypt it.
    await saveCloudflareSettings(stored!);
    expect((await getCloudflareSettings())?.apiToken).toBe(stored!.apiToken);
  });
});
