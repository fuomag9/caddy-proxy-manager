/**
 * The master seals the secrets in a sync payload to the receiving slave's key
 * and nonce (fetched from GET /api/instances/sync) and the slave opens them
 * before it stores anything. Master and slave run with their own databases
 * and SESSION_SECRETs; fetch is routed to the slave's route handlers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';
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
  // Kept when modules are reloaded to simulate a master restart.
  ctx.master ??= createTestDb();
  ctx.slave ??= createTestDb();
  ctx.active ??= ctx.master;
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
vi.mock('../../src/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/api-auth')>()),
  requireApiAdmin: async () => ({ userId: 1, role: 'admin', authMethod: 'bearer' }),
}));

import * as schema from '../../src/lib/db/schema';
import { GET, POST } from '../../app/api/instances/sync/route';
import { GET as getSettingsGroup } from '../../app/api/v1/settings/[group]/route';
import { getSlaveLastSync, syncInstances, type SyncPayload } from '../../src/lib/instance-sync';
import { listInstances } from '../../src/lib/models/instances';
import { decryptSecret, encryptSecret, isEncryptedSecret, reencryptSecret } from '../../src/lib/secret';
import { encryptProviderCredentials } from '../../src/lib/dns-providers';
import { setSetting } from '../../src/lib/settings';
import { logAuditEvent } from '../../src/lib/audit';
import { createSyncKeyChallenge, createSyncKeyResponse, getSyncPublicKey } from '../../src/lib/sync-crypto';
import {
  SYNC_KEY_PINS_SETTING,
  deleteSyncKeyPin,
  getSyncKeyPin,
  listSyncKeyPins,
  setSyncKeyPin,
} from '../../src/lib/instance-sync-key-pins';

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

type Exchange = { method: string; url: string; body: string | null; status: number; reply: unknown };
const exchanges: Exchange[] = [];

/** Run `fn` as the slave: its database, SESSION_SECRET (and SESSION_SECRET_PREVIOUS) and mode. */
async function asSlave<T>(
  fn: () => Promise<T> | T,
  secret = SLAVE_SECRET,
  mode = 'slave',
  previousSecrets: string[] = [],
): Promise<T> {
  const saved = {
    db: ctx.active,
    secret: ctx.config.sessionSecret,
    previous: ctx.config.previousSessionSecrets,
    mode: process.env.INSTANCE_MODE,
  };
  ctx.active = ctx.slave;
  ctx.config.sessionSecret = secret;
  ctx.config.previousSessionSecrets = previousSecrets;
  process.env.INSTANCE_MODE = mode;
  try {
    return await fn();
  } finally {
    ctx.active = saved.db;
    ctx.config.sessionSecret = saved.secret;
    ctx.config.previousSessionSecrets = saved.previous;
    if (saved.mode === undefined) delete process.env.INSTANCE_MODE;
    else process.env.INSTANCE_MODE = saved.mode;
  }
}

/**
 * Route the master's requests to the slave. `key` replaces the slave's reply
 * to the key request (it gets the request URL), `tamper` changes a sync body
 * on the way, and the slave runs with `keySecret` for the key request and
 * `syncSecret` for the sync, and with `previousSecrets` as
 * SESSION_SECRET_PREVIOUS.
 */
function connectToSlave(options: {
  key?: (url: string) => Response | Promise<Response>;
  tamper?: (payload: SyncPayload) => void;
  keySecret?: string;
  syncSecret?: string;
  previousSecrets?: string[];
  mode?: string;
} = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const url = String(input);
    if (method === 'GET' && options.key) {
      exchanges.push({ method, url, body: null, status: 0, reply: null });
      return options.key(url);
    }
    let body = typeof init?.body === 'string' ? init.body : null;
    if (body !== null && options.tamper) {
      const payload = JSON.parse(body) as SyncPayload;
      options.tamper(payload);
      body = JSON.stringify(payload);
    }
    const request = new NextRequest(url, { method, headers: init?.headers, body });
    const secret = (method === 'POST' ? options.syncSecret : options.keySecret) ?? SLAVE_SECRET;
    const response = await asSlave(
      () => (method === 'POST' ? POST(request) : GET(request)),
      secret,
      options.mode,
      options.previousSecrets,
    );
    exchanges.push({ method, url, body, status: response.status, reply: await response.clone().json() });
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
  ctx.config.previousSessionSecrets = [];
  process.env.INSTANCE_MODE = 'master';
  process.env.INSTANCE_SYNC_TOKEN = TOKEN;
  exchanges.length = 0;
  vi.mocked(logAuditEvent).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INSTANCE_MODE;
  delete process.env.INSTANCE_SYNC_TOKEN;
  delete process.env.INSTANCE_SLAVES;
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
    // Restarted with the new secret, and the old one in SESSION_SECRET_PREVIOUS.
    connectToSlave({
      keySecret: ROTATED_SLAVE_SECRET,
      syncSecret: ROTATED_SLAVE_SECRET,
      previousSecrets: [SLAVE_SECRET],
    });
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
    // Nothing is pinned, a key the key exchange refuses included.
    expect(await listSyncKeyPins()).toEqual([]);
  });

  it.each([
    '0000000000000000000000000000000000000000000000000000000000000000',
    'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  ])('never pins the low-order key %s, even when the payload has nothing to seal', async (hex) => {
    // A new master: an instance, and no DNS credentials or certificate keys.
    const now = new Date().toISOString();
    await ctx.master.insert(schema.instances).values({
      name: 'Replica', baseUrl: SLAVE_URL, apiToken: encryptSecret(TOKEN), enabled: true, createdAt: now, updatedAt: now,
    });
    const lowOrder = Buffer.from(hex, 'hex');
    connectToSlave({
      key: () => Response.json({
        ...slaveKeyResponse(),
        publicKey: lowOrder.toString('base64'),
        keyId: createHash('sha256').update(lowOrder).digest('hex').slice(0, 16),
      }),
    });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe('Slave returned an invalid sync key');
    expect(await listSyncKeyPins()).toEqual([]);
  });
});

describe('sync key pinning', () => {
  const KEY_CHANGED = 'Slave sync key changed; verify the slave, then pin its new key or reset its key pin';
  const CONFIG_MISMATCH = 'Slave sync key does not match the key configured in INSTANCE_SLAVES';
  const SLAVE_CHANGED = 'Slave instance was removed or its base URL changed during the sync';
  const UNRELATED_SECRET = 'unrelated-secret-for-sealed-sync-tests-5555555555';
  const ATTACKER_SECRET = 'attacker-secret-for-sealed-sync-tests-6666666666';
  // A public placeholder: its private key is known to everyone.
  const PLACEHOLDER_SECRET = 'change-me-in-production';

  const keyOf = (secret: string) => asSlave(() => getSyncPublicKey(), secret);
  const pinned = () => getSyncKeyPin(SLAVE_URL);
  const challengeOf = (url: string) => new URL(url).searchParams.get('challenge')!;

  /** The slave's reply to a key request with `challenge`, as it would answer it. */
  async function slaveKeyReply(challenge: string | null, secret: string, previousSecrets: string[] = []) {
    const query = challenge === null ? '' : `?challenge=${challenge}`;
    const request = new NextRequest(`${SLAVE_URL}/api/instances/sync${query}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const response = await asSlave(() => GET(request), secret, 'slave', previousSecrets);
    return (await response.json()) as ReturnType<typeof createSyncKeyResponse>;
  }

  /**
   * A rotation proof by the key the slave derives from `secret`, computed as
   * sync-crypto.ts specifies, as anyone who knows `secret` could.
   */
  async function rotationProofBy(secret: string, challenge: string, currentPublicKey: Buffer, nonce: string) {
    const previous = await keyOf(secret);
    const seed = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'cpm-instance-sync-x25519:v1', 32));
    const challengePublicKey = Buffer.from(challenge, 'base64url');
    const shared = diffieHellman({
      privateKey: createPrivateKey({
        key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), seed]),
        format: 'der',
        type: 'pkcs8',
      }),
      publicKey: createPublicKey({
        key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), challengePublicKey]),
        format: 'der',
        type: 'spki',
      }),
    });
    const key = Buffer.from(hkdfSync(
      'sha256', shared, Buffer.concat([challengePublicKey, previous.publicKey]), 'cpm-instance-sync-key-rotation:v1', 32,
    ));
    return {
      keyId: previous.keyId,
      proof: createHmac('sha256', key).update(currentPublicKey).update(nonce, 'utf8').digest('base64url'),
    };
  }

  /** The first sync: pins the slave's key. */
  async function syncAndPin() {
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    vi.restoreAllMocks();
    exchanges.length = 0;
    vi.mocked(logAuditEvent).mockClear();
    return (await pinned())!;
  }

  it('pins the key a slave presents on first use, then syncs while it is unchanged', async () => {
    await setUpMaster();
    const [instance] = await listInstances();
    const slaveKey = await keyOf(SLAVE_SECRET);
    connectToSlave();

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    const pin = await pinned();
    expect(pin).toEqual({
      keyId: slaveKey.keyId,
      publicKey: slaveKey.publicKey.toString('base64'),
      pinnedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      source: 'first-use',
    });
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'instance_sync_key_pinned',
      entityType: 'instance',
      entityId: instance.id,
      summary: `Pinned sync key ${slaveKey.keyId} of slave "Replica" on first use`,
    }));

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await pinned()).toEqual(pin);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);

    // Every key request carries a fresh challenge.
    const challenges = exchanges.filter((exchange) => exchange.method === 'GET').map((exchange) => challengeOf(exchange.url));
    expect(challenges).toEqual([expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)]);
    expect(challenges[0]).not.toBe(challenges[1]);
  });

  it('refuses a changed key without a rotation proof, posting nothing and keeping the pin', async () => {
    await setUpMaster();
    const pin = await syncAndPin();
    const before = await slaveSyncedState();
    const warn = vi.spyOn(console, 'warn');
    connectToSlave({ keySecret: ROTATED_SLAVE_SECRET, syncSecret: ROTATED_SLAVE_SECRET });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET', 'GET']);
    expect((await listInstances())[0].lastSyncError).toBe(KEY_CHANGED);
    expect(await pinned()).toEqual(pin);
    expect(await slaveSyncedState()).toEqual(before);
    expect(logAuditEvent).not.toHaveBeenCalled();
    // Reported once, with the key ids and nothing secret.
    const reports = warn.mock.calls.map((call) => call.map(String).join(' ')).filter((line) => line.includes('rotation proof'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('"Replica"');
    expect(reports[0]).toContain(pin.keyId);
    expect(reports[0]).toContain((await keyOf(ROTATED_SLAVE_SECRET)).keyId);
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of [TOKEN, SLAVE_SECRET, ROTATED_SLAVE_SECRET, pin.publicKey, 'replica.example.com']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('reports a changed key again only when the key presented changes', async () => {
    await setUpMaster();
    await syncAndPin();
    const warn = vi.spyOn(console, 'warn');
    const presented = [ROTATED_SLAVE_SECRET, ROTATED_SLAVE_SECRET, ATTACKER_SECRET, ROTATED_SLAVE_SECRET];
    connectToSlave({ key: async () => Response.json(await slaveKeyReply(null, presented.shift()!)) });

    for (let i = 0; i < 4; i++) {
      expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    }

    const reports = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes('rotation proof'));
    const [rotated, attacker] = [(await keyOf(ROTATED_SLAVE_SECRET)).keyId, (await keyOf(ATTACKER_SECRET)).keyId];
    expect(reports.map((line) => line.match(/presented sync key ([0-9a-f]{16})/)![1])).toEqual([rotated, attacker, rotated]);
  });

  it('re-pins a key rotated the documented way (old secret in SESSION_SECRET_PREVIOUS) and syncs to it', async () => {
    await setUpMaster();
    const [instance] = await listInstances();
    const oldPin = await syncAndPin();
    const rotated = await keyOf(ROTATED_SLAVE_SECRET);
    const rotatedSlave = {
      keySecret: ROTATED_SLAVE_SECRET,
      syncSecret: ROTATED_SLAVE_SECRET,
      previousSecrets: [UNRELATED_SECRET, SLAVE_SECRET],
    };
    connectToSlave(rotatedSlave);

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });

    expect(await pinned()).toEqual({
      keyId: rotated.keyId,
      publicKey: rotated.publicKey.toString('base64'),
      pinnedAt: expect.any(String),
      source: 'rotation',
    });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'instance_sync_key_rotated',
      entityType: 'instance',
      entityId: instance.id,
      data: expect.objectContaining({ keyId: rotated.keyId, previousKeyId: oldPin.keyId, source: 'rotation' }),
    }));
    expect(syncExchange()!.body).toContain(`"secrets_sealed_key_id":"${rotated.keyId}"`);
    await asSlave(async () => {
      const synced = (await storedSetting(ctx.slave, 'synced:dns_provider')) as DnsProviderSetting;
      expect(decryptSecret(synced.providers.cloudflare.api_token)).toBe(DNS_TOKEN);
    }, ROTATED_SLAVE_SECRET);

    // Once re-pinned, the slave no longer needs SESSION_SECRET_PREVIOUS.
    vi.restoreAllMocks();
    connectToSlave({ keySecret: ROTATED_SLAVE_SECRET, syncSecret: ROTATED_SLAVE_SECRET });
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect((await pinned())!.keyId).toBe(rotated.keyId);
  });

  type Forgery = (url: string) => Promise<Response>;
  const rotatedReply = (url: string, previousSecrets: string[] = []) =>
    slaveKeyReply(challengeOf(url), ROTATED_SLAVE_SECRET, previousSecrets);

  it.each<[string, Forgery]>([
    ['a forged proof', async (url) => {
      const reply = await rotatedReply(url);
      return Response.json({
        ...reply,
        rotationProofs: [{ keyId: (await keyOf(SLAVE_SECRET)).keyId, proof: randomBytes(32).toString('base64url') }],
      });
    }],
    ['only a proof by another previous key', async (url) => Response.json(await rotatedReply(url, [UNRELATED_SECRET]))],
    ["another key's proof under the pinned key id", async (url) => {
      const reply = await rotatedReply(url, [UNRELATED_SECRET]);
      const pinnedKeyId = (await keyOf(SLAVE_SECRET)).keyId;
      return Response.json({ ...reply, rotationProofs: reply.rotationProofs!.map((proof) => ({ ...proof, keyId: pinnedKeyId })) });
    }],
    ['a proof replayed from a key request with another challenge', async () =>
      Response.json(await slaveKeyReply(createSyncKeyChallenge().value, ROTATED_SLAVE_SECRET, [SLAVE_SECRET]))],
    ["the slave's proof relayed with another key", async (url) => {
      const reply = await rotatedReply(url, [SLAVE_SECRET]);
      const attacker = await keyOf(ATTACKER_SECRET);
      return Response.json({ ...reply, publicKey: attacker.publicKey.toString('base64'), keyId: attacker.keyId });
    }],
    ["the slave's proof with another nonce", async (url) => {
      const reply = await rotatedReply(url, [SLAVE_SECRET]);
      const other = await slaveKeyReply(null, ROTATED_SLAVE_SECRET);
      return Response.json({ ...reply, nonce: other.nonce });
    }],
  ])('refuses a changed key with %s', async (_case, forgery) => {
    await setUpMaster();
    const pin = await syncAndPin();
    const before = await slaveSyncedState();
    connectToSlave({ key: forgery, syncSecret: ROTATED_SLAVE_SECRET });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe(KEY_CHANGED);
    expect(await pinned()).toEqual(pin);
    expect(await slaveSyncedState()).toEqual(before);
  });

  it('never re-pins through a key derived from a public placeholder secret', async () => {
    await setUpMaster();
    connectToSlave({ keySecret: PLACEHOLDER_SECRET, syncSecret: PLACEHOLDER_SECRET });
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    vi.restoreAllMocks();
    const pin = (await pinned())!;
    expect(pin.keyId).toBe((await keyOf(PLACEHOLDER_SECRET)).keyId);

    // The slave sends no proof by a placeholder key...
    const reply = await slaveKeyReply(createSyncKeyChallenge().value, ROTATED_SLAVE_SECRET, [PLACEHOLDER_SECRET]);
    expect(reply).not.toHaveProperty('rotationProofs');
    connectToSlave({
      keySecret: ROTATED_SLAVE_SECRET,
      syncSecret: ROTATED_SLAVE_SECRET,
      previousSecrets: [PLACEHOLDER_SECRET],
    });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect((await listInstances())[0].lastSyncError).toBe(KEY_CHANGED);

    // ...and the master accepts none, though anyone can compute one.
    vi.restoreAllMocks();
    exchanges.length = 0;
    const attacker = await keyOf(ATTACKER_SECRET);
    connectToSlave({
      key: async (url) => {
        const nonce = (await slaveKeyReply(null, ROTATED_SLAVE_SECRET)).nonce;
        return Response.json({
          version: 1,
          algorithm: 'x25519-hkdf-sha256-aes256gcm',
          publicKey: attacker.publicKey.toString('base64'),
          keyId: attacker.keyId,
          nonce,
          rotationProofs: [await rotationProofBy(PLACEHOLDER_SECRET, challengeOf(url), attacker.publicKey, nonce)],
        });
      },
    });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect(await pinned()).toEqual(pin);
  });

  it('accepts a proof computed as specified, by the pinned key', async () => {
    await setUpMaster();
    await syncAndPin();
    const rotated = await keyOf(ROTATED_SLAVE_SECRET);
    connectToSlave({
      key: async (url) => {
        const reply = await slaveKeyReply(null, ROTATED_SLAVE_SECRET);
        return Response.json({
          ...reply,
          rotationProofs: [await rotationProofBy(SLAVE_SECRET, challengeOf(url), rotated.publicKey, reply.nonce)],
        });
      },
      syncSecret: ROTATED_SLAVE_SECRET,
    });

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await pinned()).toMatchObject({ keyId: rotated.keyId, source: 'rotation' });
  });

  it('fails a pinned slave that answers 405, also after the master restarts; a reset pin allows the legacy payload', async () => {
    await setUpMaster();
    await syncAndPin();
    const before = await slaveSyncedState();

    // A new master process: nothing it knows about the slave is kept in memory.
    vi.resetModules();
    const restarted = await import('../../src/lib/instance-sync');
    connectToSlave({ key: () => new Response(null, { status: 405 }) });

    expect(await restarted.syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe('Sync key request failed with HTTP 405');
    expect(await slaveSyncedState()).toEqual(before);

    expect(await deleteSyncKeyPin(SLAVE_URL)).toBe(true);
    exchanges.length = 0;
    expect(await restarted.syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(JSON.parse(syncExchange()!.body!)).not.toHaveProperty('secrets_sealed_key_id');
  });

  it('fails closed on a stored pin this release cannot read, until the slave\'s key is pinned', async () => {
    await setUpMaster();
    const stored = JSON.stringify({ [SLAVE_URL]: { version: 2, key: 'from-a-newer-release', pinnedAt: '2026-01-01T00:00:00.000Z' } });
    await ctx.master.insert(schema.settings).values({ key: SYNC_KEY_PINS_SETTING, value: stored, updatedAt: new Date().toISOString() });
    const warn = vi.spyOn(console, 'warn');
    connectToSlave();

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect((await listInstances())[0].lastSyncError).toBe(KEY_CHANGED);
    expect(JSON.stringify(warn.mock.calls)).toContain('cannot be read by this release');

    // An older release's 405 does not get the legacy payload either.
    vi.restoreAllMocks();
    exchanges.length = 0;
    connectToSlave({ key: () => new Response(null, { status: 405 }) });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect(await storedSetting(ctx.master, SYNC_KEY_PINS_SETTING)).toEqual(JSON.parse(stored));
    expect(logAuditEvent).not.toHaveBeenCalled();

    // Pinning the slave's key replaces it.
    vi.restoreAllMocks();
    await setSyncKeyPin(SLAVE_URL, { publicKey: (await keyOf(SLAVE_SECRET)).publicKey, source: 'manual' });
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
  });

  it('syncs only to a key an admin pinned before the first sync', async () => {
    await setUpMaster();
    const slaveKey = await keyOf(SLAVE_SECRET);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: slaveKey.publicKey, source: 'manual' });

    // Something else answering at the slave's URL is not pinned on first use...
    connectToSlave({ keySecret: ATTACKER_SECRET, syncSecret: ATTACKER_SECRET });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect((await listInstances())[0].lastSyncError).toBe(KEY_CHANGED);
    // ...nor sent the legacy payload...
    vi.restoreAllMocks();
    connectToSlave({ key: () => new Response(null, { status: 405 }) });
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(exchanges.filter((exchange) => exchange.method === 'POST')).toEqual([]);

    // ...and the slave itself syncs, keeping the pin as set.
    vi.restoreAllMocks();
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await pinned()).toEqual(pin);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<unknown>]>([
    ['removed', () => ctx.master.delete(schema.instances)],
    ['moved to another URL', () => ctx.master.update(schema.instances).set({ baseUrl: 'https://moved.example.com' })],
  ])('pins nothing for an instance %s while its key was fetched', async (_case, change) => {
    await setUpMaster();
    connectToSlave({
      key: async () => {
        await change();
        return Response.json(slaveKeyResponse());
      },
    });

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
    expect(await listSyncKeyPins()).toEqual([]);
    expect(logAuditEvent).not.toHaveBeenCalled();
    const [moved] = await listInstances();
    if (moved) expect(moved.lastSyncError).toBe(SLAVE_CHANGED);
  });

  describe.each<[string, (key: { keyId: string; publicKey: Buffer }) => Record<string, string>]>([
    ['syncKeyId', (key) => ({ syncKeyId: key.keyId })],
    ['syncPublicKey', (key) => ({ syncPublicKey: key.publicKey.toString('base64') })],
    ['syncPublicKey and syncKeyId', (key) => ({ syncKeyId: key.keyId, syncPublicKey: key.publicKey.toString('base64') })],
  ])('with %s in INSTANCE_SLAVES', (_field, configuredPin) => {
    async function setUpEnvSlave(pin: Record<string, string>) {
      await setUpMaster();
      await ctx.master.delete(schema.instances);
      process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'replica', url: SLAVE_URL, token: TOKEN, ...pin }]);
    }

    it('syncs when the key matches, without storing a pin', async () => {
      await setUpEnvSlave(configuredPin(await keyOf(SLAVE_SECRET)));
      connectToSlave();

      expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
      expect(await listSyncKeyPins()).toEqual([]);
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it.each<[string, Parameters<typeof connectToSlave>[0], string]>([
      ['another key, even with a valid rotation proof', {
        keySecret: ROTATED_SLAVE_SECRET,
        syncSecret: ROTATED_SLAVE_SECRET,
        previousSecrets: [SLAVE_SECRET],
      }, CONFIG_MISMATCH],
      ['HTTP 405 (never the legacy payload)', { key: () => new Response(null, { status: 405 }) },
        'Sync key request failed with HTTP 405'],
    ])('fails when the slave presents %s', async (_case, options, reason) => {
      await setUpEnvSlave(configuredPin(await keyOf(SLAVE_SECRET)));
      const error = vi.spyOn(console, 'error');
      connectToSlave(options);

      expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

      expect(exchanges.map((exchange) => exchange.method)).toEqual(['GET']);
      expect(error).toHaveBeenCalledWith('Environment-configured instance sync failed', expect.objectContaining({ reason }));
      expect(await listSyncKeyPins()).toEqual([]);
      expect(await slaveSyncedState()).toEqual({ settings: [], certificates: [] });
    });
  });

  /**
   * Answer every key request with the slave's key and every sync with
   * `{ ok: true }`, without running the slave: asSlave switches the database
   * and secret for everything, so it cannot serve concurrent syncs.
   */
  function connectToStaticSlave() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) =>
      init?.method === 'POST' ? Response.json({ ok: true }) : Response.json(slaveKeyResponse())
    );
  }

  it('keys pins by normalized base URL, for INSTANCE_SLAVES entries and instances alike', async () => {
    await setUpMaster();
    const [instance] = await listInstances();
    await ctx.master.delete(schema.instances);
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'replica', url: 'HTTPS://Replica.Example.com:443/', token: TOKEN }]);
    const slaveKey = await keyOf(SLAVE_SECRET);
    connectToSlave();

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await listSyncKeyPins()).toEqual([
      { identity: SLAVE_URL, keyId: slaveKey.keyId, publicKey: slaveKey.publicKey.toString('base64'), pinnedAt: expect.any(String), source: 'first-use' },
    ]);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'instance_sync_key_pinned', entityId: null }));

    // An instance at the same URL has the same pin; one at another URL starts with a pin of its own.
    delete process.env.INSTANCE_SLAVES;
    const now = new Date().toISOString();
    await ctx.master.insert(schema.instances).values([
      { ...instance, id: undefined, apiToken: encryptSecret(TOKEN), createdAt: now, updatedAt: now },
      { ...instance, id: undefined, name: 'Other', baseUrl: 'https://replica-2.example.com/cpm/', apiToken: encryptSecret(TOKEN), createdAt: now, updatedAt: now },
    ]);
    vi.mocked(logAuditEvent).mockClear();
    vi.restoreAllMocks();
    connectToStaticSlave();

    expect(await syncInstances()).toMatchObject({ success: 2, failed: 0 });
    expect((await listSyncKeyPins()).map((pin) => [pin.identity, pin.keyId, pin.source])).toEqual([
      ['https://replica-2.example.com/cpm', slaveKey.keyId, 'first-use'],
      [SLAVE_URL, slaveKey.keyId, 'first-use'],
    ]);
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: `Pinned sync key ${slaveKey.keyId} of slave "Other" on first use`,
    }));
  });

  it('sends every request of a slave to the endpoint its pin is kept under', async () => {
    await setUpMaster();
    const now = new Date().toISOString();
    await ctx.master.update(schema.instances).set({ baseUrl: 'https://replica.example.com/cpm\\' });
    const [instance] = await listInstances();
    await ctx.master.insert(schema.instances).values({
      ...instance, id: undefined, name: 'Other', baseUrl: 'HTTPS://Replica-2.Example.com//', apiToken: encryptSecret(TOKEN), createdAt: now, updatedAt: now,
    });
    const fetchSpy = connectToStaticSlave();

    expect(await syncInstances()).toMatchObject({ success: 2, failed: 0 });

    const endpoints = fetchSpy.mock.calls.map(([input, init]) => [init?.method, String(input).replace(/\?.*$/, '')]);
    expect(endpoints.sort()).toEqual([
      ['GET', 'https://replica-2.example.com/api/instances/sync'],
      ['GET', 'https://replica.example.com/cpm/api/instances/sync'],
      ['POST', 'https://replica-2.example.com/api/instances/sync'],
      ['POST', 'https://replica.example.com/cpm/api/instances/sync'],
    ]);
    expect((await listSyncKeyPins()).map((pin) => pin.identity)).toEqual([
      'https://replica-2.example.com', 'https://replica.example.com/cpm',
    ]);
  });

  it('pins every slave of one sync', async () => {
    await setUpMaster();
    const [instance] = await listInstances();
    const now = new Date().toISOString();
    await ctx.master.insert(schema.instances).values(['a', 'b', 'c'].map((name) => ({
      ...instance, id: undefined, name, baseUrl: `https://${name}.example.com`, apiToken: encryptSecret(TOKEN), createdAt: now, updatedAt: now,
    })));
    connectToStaticSlave();

    expect(await syncInstances()).toMatchObject({ success: 4, failed: 0 });
    expect((await listSyncKeyPins()).map((pin) => pin.identity)).toEqual([
      'https://a.example.com', 'https://b.example.com', 'https://c.example.com', SLAVE_URL,
    ]);
  });

  it('keeps pins out of the sync payload and the settings API', async () => {
    await setUpMaster();
    connectToSlave();
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    const pin = (await pinned())!;

    const { body } = syncExchange()!;
    expect(body).not.toContain(SYNC_KEY_PINS_SETTING);
    expect(body).not.toContain(pin.publicKey);
    const slaveKeys = (await ctx.slave.select().from(schema.settings).all()).map((row) => row.key);
    expect(slaveKeys.some((key) => key.includes(SYNC_KEY_PINS_SETTING))).toBe(false);

    for (const group of [SYNC_KEY_PINS_SETTING, 'instance-sync-key-pins']) {
      const response = await getSettingsGroup(
        new NextRequest(`https://master.example.com/api/v1/settings/${group}`),
        { params: Promise.resolve({ group }) },
      );
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain(pin.keyId);
    }
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
