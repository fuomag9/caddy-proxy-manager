/**
 * Secrets inside synced settings (DNS provider credentials) leave the master
 * decrypted and are re-encrypted with the slave's own SESSION_SECRET, so a
 * master and its slaves do not have to share SESSION_SECRET.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({
  db: null as unknown as TestDb,
  config: {
    sessionSecret: 'master-secret-for-instance-sync-tests-0123456789',
    previousSessionSecrets: [] as string[],
  },
}));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
  };
});
vi.mock('../../src/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/config')>()),
  config: ctx.config,
}));
vi.mock('../../src/lib/l4-ports', () => ({
  getL4PortsDiff: async () => ({ currentPorts: [], requiredPorts: [], needsApply: false }),
  applyL4Ports: vi.fn(),
}));

import * as schema from '../../src/lib/db/schema';
import { applySyncPayload, buildSyncPayload, type SyncPayload } from '../../src/lib/instance-sync';
import { decryptSecret, encryptSecret, isEncryptedSecret, reencryptSecret } from '../../src/lib/secret';
import { buildDnsChallengeConfig, encryptProviderCredentials } from '../../src/lib/dns-providers';
import { getDnsProviderSettings, setSetting } from '../../src/lib/settings';

const MASTER_SECRET = 'master-secret-for-instance-sync-tests-0123456789';
const SLAVE_SECRET = 'slave-secret-for-instance-sync-tests-9876543210';
const OLD_MASTER_SECRET = 'old-master-secret-for-instance-sync-0000000000';
const DNS_TOKEN = 'cloudflare-api-token-sentinel';

function useSecret(secret: string, previous: string[] = []) {
  ctx.config.sessionSecret = secret;
  ctx.config.previousSessionSecrets = previous;
}

/** The JSON value of one settings row, or undefined. */
async function storedSetting(key: string): Promise<unknown> {
  const row = (await ctx.db.select().from(schema.settings).all()).find((r) => r.key === key);
  return row ? JSON.parse(row.value) : undefined;
}

/** Serialize like the HTTP transport does. */
function overTheWire(payload: SyncPayload): SyncPayload {
  return JSON.parse(JSON.stringify(payload));
}

/** A payload with every setting null except `dns_provider`, as an older or newer master sends it. */
function payloadWithDnsProvider(dnsProvider: unknown): SyncPayload {
  return {
    generated_at: new Date().toISOString(),
    settings: {
      general: null, acme: null, cloudflare: null, dns_provider: dnsProvider, authentik: null,
      metrics: null, logging: null, dns: null, upstream_dns_resolution: null, waf: null,
      geoblock: null, error_pages: null, trusted_proxies: null,
    },
    data: {
      certificates: [], caCertificates: [], issuedClientCertificates: [],
      accessLists: [], accessListEntries: [], proxyHosts: [],
    },
  };
}

/** Apply a payload on a fresh slave database that uses SLAVE_SECRET only. */
async function applyOnSlave(payload: SyncPayload) {
  await ctx.db.delete(schema.settings);
  process.env.INSTANCE_MODE = 'slave';
  useSecret(SLAVE_SECRET);
  await applySyncPayload(overTheWire(payload));
}

/** The Cloudflare API token a slave would hand to Caddy. */
async function effectiveCloudflareToken(): Promise<unknown> {
  const settings = await getDnsProviderSettings();
  const challenge = buildDnsChallengeConfig('cloudflare', settings!.providers.cloudflare, []);
  return (challenge!.provider as Record<string, unknown>).api_token;
}

beforeEach(async () => {
  await ctx.db.delete(schema.settings);
  delete process.env.INSTANCE_MODE;
  useSecret(MASTER_SECRET);
});

afterEach(() => {
  delete process.env.INSTANCE_MODE;
  vi.restoreAllMocks();
});

describe('buildSyncPayload settings secrets', () => {
  it('sends DNS provider credentials decrypted, so no master-key ciphertext leaves the master', async () => {
    const stored = {
      providers: {
        cloudflare: encryptProviderCredentials('cloudflare', { api_token: DNS_TOKEN }),
        route53: encryptProviderCredentials('route53', {
          access_key_id: 'AKIAEXAMPLE', secret_access_key: 'route53-secret', region: 'eu-west-1',
        }),
      },
      default: 'cloudflare',
    };
    await setSetting('dns_provider', stored);

    const payload = await buildSyncPayload();

    expect(JSON.stringify(payload.settings)).not.toContain('enc:v1:');
    expect(payload.settings.dns_provider).toEqual({
      providers: {
        cloudflare: { api_token: DNS_TOKEN },
        route53: { access_key_id: 'AKIAEXAMPLE', secret_access_key: 'route53-secret', region: 'eu-west-1' },
      },
      default: 'cloudflare',
    });
    // The master's own copy stays encrypted.
    expect(await storedSetting('dns_provider')).toEqual(stored);
    // The slave is told exactly which strings to encrypt again.
    expect(payload.settings_secret_paths).toEqual([
      ['dns_provider', 'providers', 'cloudflare', 'api_token'],
      ['dns_provider', 'providers', 'route53', 'secret_access_key'],
    ]);
  });

  it('decrypts the single-provider format of older releases too', async () => {
    await setSetting('dns_provider', {
      provider: 'cloudflare',
      credentials: { api_token: encryptSecret(DNS_TOKEN) },
    });

    const payload = await buildSyncPayload();

    expect(payload.settings.dns_provider).toEqual({ provider: 'cloudflare', credentials: { api_token: DNS_TOKEN } });
    expect(payload.settings_secret_paths).toEqual([['dns_provider', 'credentials', 'api_token']]);
  });

  it('sends a value no key decrypts as stored, warning once per process without the value', async () => {
    useSecret('a-secret-whose-key-this-master-lost-0123456789');
    const lost = encryptSecret(DNS_TOKEN);
    useSecret(MASTER_SECRET);
    await setSetting('dns_provider', { providers: { cloudflare: { api_token: lost } }, default: 'cloudflare' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const payload = await buildSyncPayload();

    expect(payload.settings.dns_provider).toEqual({ providers: { cloudflare: { api_token: lost } }, default: 'cloudflare' });
    expect(payload.settings_secret_paths).toEqual([]);
    const syncWarnings = () => warn.mock.calls.map((call) => call.map(String).join(' ')).filter((line) => line.startsWith('Instance sync'));
    expect(syncWarnings()).toHaveLength(1);
    expect(syncWarnings()[0]).toContain('dns_provider.providers.cloudflare.api_token');
    expect(syncWarnings()[0]).not.toContain(lost);

    // Every later sync (config changes, periodic ticks) sends it again silently.
    await buildSyncPayload();
    await buildSyncPayload();
    expect(syncWarnings()).toHaveLength(1);
  });
});

describe('applySyncPayload settings secrets', () => {
  it('lets a slave with a different SESSION_SECRET use the synced DNS credentials', async () => {
    await setSetting('dns_provider', {
      providers: { cloudflare: encryptProviderCredentials('cloudflare', { api_token: DNS_TOKEN }) },
      default: 'cloudflare',
    });
    const payload = overTheWire(await buildSyncPayload());

    // Switch to the slave: its own database and its own secret, without the master's.
    await ctx.db.delete(schema.settings);
    process.env.INSTANCE_MODE = 'slave';
    useSecret(SLAVE_SECRET);
    await applySyncPayload(payload);

    const synced = (await storedSetting('synced:dns_provider')) as { providers: { cloudflare: { api_token: string } } };
    const token = synced.providers.cloudflare.api_token;
    expect(isEncryptedSecret(token)).toBe(true);
    expect(reencryptSecret(token)).toBeNull();
    expect(decryptSecret(token)).toBe(DNS_TOKEN);
    expect(await effectiveCloudflareToken()).toBe(DNS_TOKEN);
  });

  it('encrypts password fields sent in plaintext in the single-provider format', async () => {
    useSecret(SLAVE_SECRET);
    await applySyncPayload(payloadWithDnsProvider({ provider: 'cloudflare', credentials: { api_token: DNS_TOKEN } }));

    const synced = (await storedSetting('synced:dns_provider')) as { credentials: { api_token: string } };
    expect(isEncryptedSecret(synced.credentials.api_token)).toBe(true);
    expect(decryptSecret(synced.credentials.api_token)).toBe(DNS_TOKEN);
  });

  it("keeps an older master's ciphertext as sent when no key on the slave decrypts it", async () => {
    useSecret(OLD_MASTER_SECRET);
    const dnsProvider = { providers: { cloudflare: { api_token: encryptSecret(DNS_TOKEN) } }, default: 'cloudflare' };

    useSecret(SLAVE_SECRET);
    await applySyncPayload(payloadWithDnsProvider(dnsProvider));

    expect(await storedSetting('synced:dns_provider')).toEqual(dnsProvider);
  });

  it("re-encrypts an older master's ciphertext with the slave's key when the slave can decrypt it", async () => {
    useSecret(OLD_MASTER_SECRET);
    const sent = encryptSecret(DNS_TOKEN);

    useSecret(SLAVE_SECRET, [OLD_MASTER_SECRET]);
    await applySyncPayload(payloadWithDnsProvider({ providers: { cloudflare: { api_token: sent } }, default: 'cloudflare' }));

    useSecret(SLAVE_SECRET);
    const synced = (await storedSetting('synced:dns_provider')) as { providers: { cloudflare: { api_token: string } } };
    const token = synced.providers.cloudflare.api_token;
    expect(token).not.toBe(sent);
    expect(reencryptSecret(token)).toBeNull();
    expect(decryptSecret(token)).toBe(DNS_TOKEN);
  });

  it('stores malformed non-string credentials as sent instead of failing the sync', async () => {
    useSecret(SLAVE_SECRET);
    const dnsProvider = { providers: { cloudflare: { api_token: 12345 } }, default: 'cloudflare' };

    await applySyncPayload(payloadWithDnsProvider(dnsProvider));

    expect(await storedSetting('synced:dns_provider')).toEqual(dnsProvider);
  });

  it('works for a slave from an older release, which stores the plaintext it receives', async () => {
    // Older slaves store synced values verbatim and only decrypt values that
    // carry the encryption prefix, so a plaintext credential is used as-is.
    process.env.INSTANCE_MODE = 'slave';
    useSecret(SLAVE_SECRET);
    await setSetting('synced:dns_provider', { providers: { cloudflare: { api_token: DNS_TOKEN } }, default: 'cloudflare' });

    expect(await effectiveCloudflareToken()).toBe(DNS_TOKEN);
  });
  it('encrypts credentials of a provider this release does not know, whatever the registry says', async () => {
    // A master on a newer release may offer providers this slave's registry lacks.
    await setSetting('dns_provider', {
      providers: { futureprovider: { api_key: encryptSecret('future-secret'), endpoint: 'https://dns.example.com' } },
      default: 'futureprovider',
    });

    await applyOnSlave(await buildSyncPayload());

    const synced = (await storedSetting('synced:dns_provider')) as {
      providers: { futureprovider: { api_key: string; endpoint: string } };
    };
    expect(isEncryptedSecret(synced.providers.futureprovider.api_key)).toBe(true);
    expect(decryptSecret(synced.providers.futureprovider.api_key)).toBe('future-secret');
    expect(synced.providers.futureprovider.endpoint).toBe('https://dns.example.com');
  });

  it('decrypts a synced credential field this registry does not mark as password (a renamed field)', async () => {
    await setSetting('dns_provider', {
      providers: { cloudflare: { api_token: encryptSecret(DNS_TOKEN), renamed_token: encryptSecret('renamed-secret') } },
      default: 'cloudflare',
    });

    await applyOnSlave(await buildSyncPayload());

    const synced = (await storedSetting('synced:dns_provider')) as { providers: { cloudflare: Record<string, string> } };
    expect(isEncryptedSecret(synced.providers.cloudflare.renamed_token)).toBe(true);
    const settings = await getDnsProviderSettings();
    const challenge = buildDnsChallengeConfig('cloudflare', settings!.providers.cloudflare, []);
    expect(challenge!.provider).toEqual({ name: 'cloudflare', api_token: DNS_TOKEN, renamed_token: 'renamed-secret' });
  });

  it('encrypts the listed secrets of any synced settings group, and nothing else', async () => {
    // Nothing encrypts authentik values today; a future encrypted field there
    // must reach the slave encrypted all the same.
    await setSetting('authentik', {
      outpostUrl: 'https://auth.example.com',
      tokens: [encryptSecret('authentik-token')],
    });

    const payload = await buildSyncPayload();
    expect(payload.settings.authentik).toEqual({ outpostUrl: 'https://auth.example.com', tokens: ['authentik-token'] });
    expect(payload.settings_secret_paths).toEqual([['authentik', 'tokens', 0]]);
    await applyOnSlave(payload);

    const synced = (await storedSetting('synced:authentik')) as { outpostUrl: string; tokens: string[] };
    expect(synced.outpostUrl).toBe('https://auth.example.com');
    expect(isEncryptedSecret(synced.tokens[0])).toBe(true);
    expect(decryptSecret(synced.tokens[0])).toBe('authentik-token');
  });

  it('ignores a malformed settings_secret_paths value instead of failing the sync', async () => {
    useSecret(SLAVE_SECRET);
    const general = { primaryDomain: 'example.com' };
    const withPaths = (paths: unknown) => ({
      ...payloadWithDnsProvider(null),
      settings: { ...payloadWithDnsProvider(null).settings, general },
      settings_secret_paths: paths,
    }) as unknown as SyncPayload;

    await applySyncPayload(withPaths({ general: ['primaryDomain'] }));
    expect(await storedSetting('synced:general')).toEqual(general);

    await applySyncPayload(withPaths([['general', { key: 'primaryDomain' }], 'general.primaryDomain', null, ['general', 'missing']]));
    expect(await storedSetting('synced:general')).toEqual(general);
  });
});
