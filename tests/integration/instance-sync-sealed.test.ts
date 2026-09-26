/**
 * The master seals the secrets in a sync payload to the receiving slave's key
 * and nonce (fetched from GET /api/instances/sync) and the slave opens them
 * before it stores anything. Master and slave run with their own databases
 * and SESSION_SECRETs; fetch is routed to the slave's route handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => {
  // Every test talks to the slave route from the same address.
  process.env.INSTANCE_SYNC_RATE_MAX = '1000';
  return {
  master: null as unknown as TestDb,
  slave: null as unknown as TestDb,
  active: null as unknown as TestDb,
  config: {
    sessionSecret: 'master-secret-for-sealed-sync-tests-0123456789',
    previousSessionSecrets: [] as string[],
  },
  };
});

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.master = createTestDb();
  ctx.slave = createTestDb();
  ctx.active = ctx.master;
  // Every access goes to the database of the instance that is running.
  const db = new Proxy({}, {
    get(_target, property) {
      const value = Reflect.get(ctx.active, property, ctx.active);
      return typeof value === 'function' ? value.bind(ctx.active) : value;
    },
  });
  return {
    default: db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null =>
      value ? new Date(value).toISOString() : null,
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
import { GET, POST } from '../../app/api/instances/sync/route';
import { getSlaveLastSync, syncInstances, type SyncPayload } from '../../src/lib/instance-sync';
import { listInstances } from '../../src/lib/models/instances';
import { decryptSecret, encryptSecret, isEncryptedSecret, reencryptSecret } from '../../src/lib/secret';
import { encryptProviderCredentials } from '../../src/lib/dns-providers';
import { setSetting } from '../../src/lib/settings';
import { createSyncKeyResponse, getSyncPublicKey } from '../../src/lib/sync-crypto';

const MASTER_SECRET = 'master-secret-for-sealed-sync-tests-0123456789';
const SLAVE_SECRET = 'slave-secret-for-sealed-sync-tests-9876543210';
const ROTATED_SLAVE_SECRET = 'rotated-slave-secret-for-sealed-sync-tests-0000';
const TOKEN = 'sealed-sync-token-0123456789abcdef0123456789';
const DNS_TOKEN = 'cloudflare-api-token-sealed-sentinel';
const ROUTE53_SECRET = 'route53-secret-sealed-sentinel';
const KEY_SENTINEL = 'sealed-sync-key-sentinel';
const OPEN_FAILED = 'Sealed secrets in the sync payload could not be opened';
const KEY_MISMATCH = 'Sync payload was sealed for a different key; retry';
const STALE = 'Sync payload was sealed for an expired or already used key request; retry';
const SLAVE_URL = 'https://replica.example.com';

const privateKeyPem = (n: number) => `-----BEGIN PRIVATE KEY-----\n${KEY_SENTINEL}-${n}\n-----END PRIVATE KEY-----`;

type DnsProviderSetting = {
  providers: {
    cloudflare: { api_token: string };
    route53: { access_key_id: string; secret_access_key: string; region: string };
  };
  default: string;
};

type Exchange = { method: string; body: string | null; status: number; reply: unknown };
const exchanges: Exchange[] = [];

/** Run `fn` as the slave: its database, SESSION_SECRET and mode. */
async function asSlave<T>(fn: () => Promise<T> | T, secret = SLAVE_SECRET, mode = 'slave'): Promise<T> {
  const saved = { db: ctx.active, secret: ctx.config.sessionSecret, mode: process.env.INSTANCE_MODE };
  ctx.active = ctx.slave;
  ctx.config.sessionSecret = secret;
  process.env.INSTANCE_MODE = mode;
  try {
    return await fn();
  } finally {
    ctx.active = saved.db;
    ctx.config.sessionSecret = saved.secret;
    if (saved.mode === undefined) delete process.env.INSTANCE_MODE;
    else process.env.INSTANCE_MODE = saved.mode;
  }
}

/**
 * Route the master's requests to the slave. `key` replaces the slave's reply
 * to the key request, `tamper` changes a sync body on the way, and the slave
 * runs with `keySecret` for the key request and `syncSecret` for the sync.
 */
function connectToSlave(options: {
  key?: () => Response;
  tamper?: (payload: SyncPayload) => void;
  keySecret?: string;
  syncSecret?: string;
  mode?: string;
} = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && options.key) {
      exchanges.push({ method, body: null, status: 0, reply: null });
      return options.key();
    }
    let body = typeof init?.body === 'string' ? init.body : null;
    if (body !== null && options.tamper) {
      const payload = JSON.parse(body) as SyncPayload;
      options.tamper(payload);
      body = JSON.stringify(payload);
    }
    const request = new NextRequest(String(input), { method, headers: init?.headers, body });
    const secret = (method === 'POST' ? options.syncSecret : options.keySecret) ?? SLAVE_SECRET;
    const response = await asSlave(() => (method === 'POST' ? POST(request) : GET(request)), secret, options.mode);
    exchanges.push({ method, body, status: response.status, reply: await response.clone().json() });
    return response;
  });
}

function syncExchange(): Exchange | undefined {
  return exchanges.find((exchange) => exchange.method === 'POST');
}

async function storedSetting(db: TestDb, key: string): Promise<unknown> {
  const row = (await db.select().from(schema.settings).all()).find((r) => r.key === key);
  return row ? JSON.parse(row.value) : undefined;
}

/** A master with DNS provider credentials, two certificates with keys, and one slave. */
async function setUpMaster() {
  await setSetting('dns_provider', {
    providers: {
      cloudflare: encryptProviderCredentials('cloudflare', { api_token: DNS_TOKEN }),
      route53: encryptProviderCredentials('route53', {
        access_key_id: 'AKIAEXAMPLE', secret_access_key: ROUTE53_SECRET, region: 'eu-west-1',
      }),
    },
    default: 'cloudflare',
  });
  const now = new Date().toISOString();
  await ctx.master.insert(schema.certificates).values([1, 2].map((n) => ({
    id: n,
    name: `Imported ${n}`,
    type: 'imported',
    domainNames: JSON.stringify([`cert${n}.example.com`]),
    autoRenew: false,
    certificatePem: `-----BEGIN CERTIFICATE-----\npublic-${n}\n-----END CERTIFICATE-----`,
    privateKeyPem: encryptSecret(privateKeyPem(n)),
    createdAt: now,
    updatedAt: now,
  })));
  await ctx.master.insert(schema.instances).values({
    name: 'Replica',
    baseUrl: SLAVE_URL,
    apiToken: encryptSecret(TOKEN),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
}

/** Everything the slave stores from a sync, to show that a rejected sync wrote nothing. */
async function slaveSyncedState() {
  return {
    settings: (await ctx.slave.select().from(schema.settings).all())
      .filter((row) => row.key.startsWith('synced:'))
      .map(({ key, value }) => ({ key, value })),
    certificates: await ctx.slave.select().from(schema.certificates).all(),
  };
}

async function clear(db: TestDb) {
  await db.delete(schema.certificates);
  await db.delete(schema.instances);
  await db.delete(schema.settings);
}

beforeEach(async () => {
  await clear(ctx.master);
  await clear(ctx.slave);
  ctx.active = ctx.master;
  ctx.config.sessionSecret = MASTER_SECRET;
  process.env.INSTANCE_MODE = 'master';
  process.env.INSTANCE_SYNC_TOKEN = TOKEN;
  exchanges.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INSTANCE_MODE;
  delete process.env.INSTANCE_SYNC_TOKEN;
});

describe('sealed instance sync', () => {
  it('seals settings secrets and certificate keys to the slave, which stores them under its own key', async () => {
    await setUpMaster();
    const masterDnsProvider = await storedSetting(ctx.master, 'dns_provider');
    connectToSlave();

    expect(await syncInstances()).toMatchObject({ total: 1, success: 1, failed: 0 });

    expect(exchanges.map((exchange) => [exchange.method, exchange.status])).toEqual([['GET', 200], ['POST', 200]]);
    const { body } = syncExchange()!;
    for (const secret of [DNS_TOKEN, ROUTE53_SECRET, KEY_SENTINEL, TOKEN, 'enc:v1:']) {
      expect(body).not.toContain(secret);
    }
    const payload = JSON.parse(body!) as SyncPayload;
    expect(payload.secrets_sealed_key_id).toBe(await asSlave(() => getSyncPublicKey().keyId));
    expect(payload.secrets_sealed_nonce).toBe((exchanges[0].reply as { nonce: string }).nonce);
    expect(payload.settings_secret_paths).toEqual([
      ['dns_provider', 'providers', 'cloudflare', 'api_token'],
      ['dns_provider', 'providers', 'route53', 'secret_access_key'],
    ]);
    const sentDnsProvider = payload.settings.dns_provider as DnsProviderSetting;
    expect(sentDnsProvider.providers.cloudflare.api_token).toMatch(/^sealed:v1:/);
    expect(sentDnsProvider.providers.route53.secret_access_key).toMatch(/^sealed:v1:/);
    expect(sentDnsProvider.providers.route53.access_key_id).toBe('AKIAEXAMPLE');
    expect(payload.data.certificates.map((certificate) => certificate.privateKeyPem))
      .toEqual([expect.stringMatching(/^sealed:v1:/), expect.stringMatching(/^sealed:v1:/)]);

    const stored = await asSlave(async () => {
      const synced = (await storedSetting(ctx.slave, 'synced:dns_provider')) as DnsProviderSetting;
      const certificates = await ctx.slave.select().from(schema.certificates).all();
      const values = [
        synced.providers.cloudflare.api_token,
        synced.providers.route53.secret_access_key,
        ...certificates.map((certificate) => certificate.privateKeyPem!),
      ];
      for (const value of values) {
        expect(isEncryptedSecret(value)).toBe(true);
        expect(reencryptSecret(value)).toBeNull();
      }
      expect(values.map((value) => decryptSecret(value))).toEqual([
        DNS_TOKEN, ROUTE53_SECRET, privateKeyPem(1), privateKeyPem(2),
      ]);
      expect((await getSlaveLastSync()).error).toBeNull();
      return values;
    });

    // The master's copy is unchanged, and its key does not open the slave's values.
    expect(await storedSetting(ctx.master, 'dns_provider')).toEqual(masterDnsProvider);
    expect(() => decryptSecret(stored[0])).toThrow();
    expect((await listInstances())[0].lastSyncError).toBeNull();
  });

  it('syncs a non-secret setting that happens to start with the sealed prefix', async () => {
    await setUpMaster();
    const body = 'sealed:v1: is our maintenance banner';
    await setSetting('default_response', { mode: 'respond', status: 200, body });
    connectToSlave();

    expect(await syncInstances()).toMatchObject({ total: 1, success: 1, failed: 0 });

    const synced = await asSlave(() => storedSetting(ctx.slave, 'synced:default_response'));
    expect(synced).toMatchObject({ body });
  });

  it('sends the legacy payload to a slave without the key endpoint (HTTP 405), warning once', async () => {
    await setUpMaster();
    const warn = vi.spyOn(console, 'warn');
    connectToSlave({ key: () => new Response(null, { status: 405 }) });

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });

    const bodies = exchanges.filter((exchange) => exchange.method === 'POST').map((exchange) => exchange.body!);
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).not.toContain(DNS_TOKEN);
      expect(body).not.toContain(ROUTE53_SECRET);
      const payload = JSON.parse(body) as SyncPayload;
      expect(payload).not.toHaveProperty('secrets_sealed_key_id');
      expect(payload).not.toHaveProperty('secrets_sealed_nonce');
      expect(payload).not.toHaveProperty('settings_secret_paths');
      // Settings secrets under the master's key, as older masters sent them;
      // certificate keys decrypted, as older masters sent them.
      const { providers } = payload.settings.dns_provider as DnsProviderSetting;
      expect(decryptSecret(providers.cloudflare.api_token)).toBe(DNS_TOKEN);
      expect(decryptSecret(providers.route53.secret_access_key)).toBe(ROUTE53_SECRET);
      expect(providers.route53.access_key_id).toBe('AKIAEXAMPLE');
      expect(payload.data.certificates.map((certificate) => certificate.privateKeyPem))
        .toEqual([privateKeyPem(1), privateKeyPem(2)]);
    }

    const legacyWarnings = warn.mock.calls.map((call) => call.map(String).join(' '))
      .filter((line) => line.includes('does not publish a sync key'));
    expect(legacyWarnings).toHaveLength(1);
    expect(legacyWarnings[0]).toContain('"Replica"');
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of [TOKEN, DNS_TOKEN, KEY_SENTINEL, 'replica.example.com']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('never sends the legacy payload to a slave that has published a key', async () => {
    await setUpMaster();
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    const before = await slaveSyncedState();

    vi.restoreAllMocks();
    exchanges.length = 0;
    const warn = vi.spyOn(console, 'warn');
    connectToSlave({ key: () => new Response(null, { status: 405 }) });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe('Sync key request failed with HTTP 405');
    expect(await slaveSyncedState()).toEqual(before);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('does not publish a sync key');
  });

  it('rejects a payload sealed to a previous slave key without writing anything; the next sync succeeds', async () => {
    await setUpMaster();
    await asSlave(() => setSetting('synced:general', { primaryDomain: 'before.example.com' }), ROTATED_SLAVE_SECRET);
    const before = await slaveSyncedState();
    // The slave's SESSION_SECRET changes between the key request and the sync.
    connectToSlave({ keySecret: SLAVE_SECRET, syncSecret: ROTATED_SLAVE_SECRET });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(syncExchange()).toMatchObject({ status: 409, reply: { error: KEY_MISMATCH } });
    expect(await slaveSyncedState()).toEqual(before);
    expect(await asSlave(() => getSlaveLastSync(), ROTATED_SLAVE_SECRET)).toMatchObject({ error: KEY_MISMATCH });
    expect((await listInstances())[0].lastSyncError).toBe('Sync failed with HTTP 409');

    vi.restoreAllMocks();
    exchanges.length = 0;
    connectToSlave({ keySecret: ROTATED_SLAVE_SECRET, syncSecret: ROTATED_SLAVE_SECRET });
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    await asSlave(async () => {
      const synced = (await storedSetting(ctx.slave, 'synced:dns_provider')) as DnsProviderSetting;
      expect(decryptSecret(synced.providers.cloudflare.api_token)).toBe(DNS_TOKEN);
    }, ROTATED_SLAVE_SECRET);
  });

  const dnsProvider = (payload: SyncPayload) => payload.settings.dns_provider as DnsProviderSetting;

  it.each<[string, (payload: SyncPayload) => void]>([
    ['a settings secret moved to another secret path', (payload) => {
      const { providers } = dnsProvider(payload);
      [providers.cloudflare.api_token, providers.route53.secret_access_key] =
        [providers.route53.secret_access_key, providers.cloudflare.api_token];
    }],
    ['a certificate key moved to another certificate', (payload) => {
      const [first, second] = payload.data.certificates;
      [first.privateKeyPem, second.privateKeyPem] = [second.privateKeyPem, first.privateKeyPem];
    }],
    ['a settings secret moved to a path that is not listed', (payload) => {
      dnsProvider(payload).providers.route53.region = dnsProvider(payload).providers.cloudflare.api_token;
    }],
    ['a listed settings secret sent unsealed', (payload) => {
      dnsProvider(payload).providers.cloudflare.api_token = DNS_TOKEN;
    }],
    ['a listed settings secret removed', (payload) => {
      delete (dnsProvider(payload).providers as Partial<DnsProviderSetting['providers']>).cloudflare;
    }],
    ['a certificate key sent unsealed', (payload) => {
      payload.data.certificates[1].privateKeyPem = privateKeyPem(2);
    }],
    ['a changed sealed value', (payload) => {
      const token = dnsProvider(payload).providers.cloudflare.api_token;
      dnsProvider(payload).providers.cloudflare.api_token = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    }],
    ['a changed setting next to a sealed secret', (payload) => {
      dnsProvider(payload).providers.route53.region = 'us-east-1';
    }],
    ['a change elsewhere in the payload', (payload) => {
      payload.data.certificates[0].domainNames = JSON.stringify(['elsewhere.example.com']);
    }],
  ])('rejects %s without writing anything', async (_case, tamper) => {
    await setUpMaster();
    const before = await slaveSyncedState();
    connectToSlave({ tamper });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(syncExchange()).toMatchObject({ status: 400, reply: { error: OPEN_FAILED } });
    expect(await slaveSyncedState()).toEqual(before);
    expect(await asSlave(() => getSlaveLastSync())).toMatchObject({ error: OPEN_FAILED });
    expect((await listInstances())[0].lastSyncError).toBe('Sync failed with HTTP 400');
  });
});

describe('sealed instance sync replay', () => {
  const ACME_DNS_PASSWORD = 'acme-dns-password-sealed-sentinel';

  type AcmeDns = { username: string; password: string; subdomain: string; server_url: string };
  const acmeDns = (payload: SyncPayload) =>
    (payload.settings.dns_provider as { providers: { acmedns: AcmeDns } }).providers.acmedns;

  /** A master sync to the slave; returns the sealed body as sent. */
  async function syncAndCapture(): Promise<SyncPayload> {
    exchanges.length = 0;
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    vi.restoreAllMocks();
    return JSON.parse(syncExchange()!.body!) as SyncPayload;
  }

  /** A request to the slave's sync route with the master's token, as anyone holding it could send. */
  async function requestSlave(method: 'GET' | 'POST', payload?: SyncPayload) {
    const request = new NextRequest(`${SLAVE_URL}/api/instances/sync`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: payload ? JSON.stringify(payload) : null,
    });
    const response = await asSlave(() => (method === 'POST' ? POST(request) : GET(request)));
    return { status: response.status, reply: await response.json() };
  }

  const newNonce = async () => ((await requestSlave('GET')).reply as { nonce: string }).nonce;
  const toAttacker = (payload: SyncPayload) => { acmeDns(payload).server_url = 'https://attacker.example.com'; };

  it.each<[string, (payload: SyncPayload) => Promise<void> | void, number, string]>([
    ['unchanged', () => {}, 409, STALE],
    ['with another acme-dns server', toAttacker, 409, STALE],
    ['with a new nonce', async (payload) => { payload.secrets_sealed_nonce = await newNonce(); }, 400, OPEN_FAILED],
    ['with a new nonce and another acme-dns server', async (payload) => {
      payload.secrets_sealed_nonce = await newNonce();
      toAttacker(payload);
    }, 400, OPEN_FAILED],
  ])('rejects a captured sealed payload replayed %s without writing anything', async (_case, change, status, error) => {
    await setUpMaster();
    await setSetting('dns_provider', {
      providers: {
        acmedns: encryptProviderCredentials('acmedns', {
          username: 'acme-user',
          password: ACME_DNS_PASSWORD,
          subdomain: 'acme-subdomain',
          server_url: 'https://acme-dns.example.com',
        }),
      },
      default: 'acmedns',
    });
    const captured = await syncAndCapture();
    expect(JSON.stringify(captured)).not.toContain(ACME_DNS_PASSWORD);
    // The master's configuration changes and it syncs again.
    await setSetting('general', { primaryDomain: 'after.example.com' });
    await syncAndCapture();
    const before = await slaveSyncedState();

    await change(captured);
    expect(await requestSlave('POST', captured)).toEqual({ status, reply: { error } });

    expect(await slaveSyncedState()).toEqual(before);
    expect(await asSlave(() => getSlaveLastSync())).toMatchObject({ error });
  });
});

describe('sealed instance sync key request', () => {
  it.each<[string, Parameters<typeof connectToSlave>[0], () => void, string]>([
    ['refuses the token', {}, () => { process.env.INSTANCE_SYNC_TOKEN = 'another-sync-token-0123456789abcdef0123'; },
      'Sync key request failed with HTTP 401'],
    ['is not a slave', { mode: 'standalone' }, () => {}, 'Sync key request failed with HTTP 403'],
    ['answers with a login page', { key: () => new Response('<html>login</html>', { status: 200 }) }, () => {},
      'Slave returned an invalid sync key'],
    // Older CPM slaves answer 405; a 404 comes from something else at that address.
    ['answers 404', { key: () => new Response('page not found', { status: 404 }) }, () => {},
      'Sync key request failed with HTTP 404'],
    ['answers { ok: true }', { key: () => Response.json({ ok: true }) }, () => {}, 'Slave returned an invalid sync key'],
    ['sends a key id that does not match the key', {
      key: () => Response.json({ ...slaveKeyResponse(), keyId: '0123456789abcdef' }),
    }, () => {}, 'Slave returned an invalid sync key'],
    ['sends a low-order key', {
      key: () => Response.json({
        version: 1,
        algorithm: 'x25519-hkdf-sha256-aes256gcm',
        publicKey: Buffer.alloc(32).toString('base64'),
        keyId: createHash('sha256').update(Buffer.alloc(32)).digest('hex').slice(0, 16),
        nonce: slaveKeyResponse().nonce,
      }),
    }, () => {}, 'Slave returned an invalid sync key'],
  ])('fails the sync before sending the payload when the slave %s', async (_case, options, arrange, error) => {
    await setUpMaster();
    arrange();
    connectToSlave(options);

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe(error);
    expect(await slaveSyncedState()).toEqual({ settings: [], certificates: [] });
  });
});

/** The slave's key response, built outside a request. */
function slaveKeyResponse() {
  const saved = ctx.config.sessionSecret;
  ctx.config.sessionSecret = SLAVE_SECRET;
  try {
    return createSyncKeyResponse();
  } finally {
    ctx.config.sessionSecret = saved;
  }
}
