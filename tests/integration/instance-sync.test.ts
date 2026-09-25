/**
 * Integration tests for buildSyncPayload and applySyncPayload
 * in src/lib/instance-sync.ts.
 *
 * We mock src/lib/db.ts to inject a fresh migrated in-memory SQLite
 * database, giving full control over table content without affecting
 * any real db file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TestDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Mock src/lib/db — must be declared before any import that uses the db.
// vi.hoisted() creates the mutable container at hoist time so the vi.mock
// factory (which also runs during hoisting) can populate it safely.
// ---------------------------------------------------------------------------

const ctx = vi.hoisted(() => {
  const { mkdirSync } = require('node:fs');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const dir = join(tmpdir(), `instance-sync-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  process.env.L4_PORTS_DIR = dir;
  return { db: null as unknown as TestDb, tmpDir: dir };
});

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

// These imports must come AFTER vi.mock to pick up the mocked module.
import { buildSyncPayload, applySyncPayload, getSlaveLastSync, syncInstances, type SyncPayload } from '../../src/lib/instance-sync';
import * as schema from '../../src/lib/db/schema';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../../src/lib/secret';
import { listInstances } from '../../src/lib/models/instances';
import { setSetting } from '../../src/lib/settings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/** A minimal proxy host record that satisfies the schema. */
function makeProxyHost(overrides: Partial<typeof schema.proxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  return {
    name: 'Test Host',
    domains: JSON.stringify(['test.example.com']),
    upstreams: JSON.stringify(['backend:8080']),
    certificateId: null,
    accessListId: null,
    ownerUserId: null,
    sslForced: false,
    hstsEnabled: false,
    hstsSubdomains: false,
    allowWebsocket: false,
    preserveHostHeader: false,
    skipHttpsHostnameValidation: false,
    meta: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies typeof schema.proxyHosts.$inferInsert;
}

/** Clean all relevant tables between tests to avoid cross-test contamination. */
async function clearTables() {
  await ctx.db.delete(schema.l4ProxyHosts);
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.accessListEntries);
  await ctx.db.delete(schema.accessLists);
  await ctx.db.delete(schema.issuedClientCertificates);
  await ctx.db.delete(schema.certificates);
  await ctx.db.delete(schema.caCertificates);
  await ctx.db.delete(schema.instances);
  await ctx.db.delete(schema.settings);
}

function cleanTmpDir() {
  for (const file of ['docker-compose.l4-ports.yml', 'l4-ports.trigger', 'l4-ports.status']) {
    const path = join(ctx.tmpDir, file);
    if (existsSync(path)) rmSync(path);
  }
}

function makeL4Host(overrides: Partial<typeof schema.l4ProxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  return {
    name: 'Test L4 Host',
    protocol: 'tcp',
    listenAddress: ':5432',
    upstreams: JSON.stringify(['10.0.0.1:5432']),
    matcherType: 'none',
    matcherValue: null,
    tlsTermination: false,
    proxyProtocolVersion: null,
    proxyProtocolReceive: false,
    ownerUserId: null,
    meta: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies typeof schema.l4ProxyHosts.$inferInsert;
}

beforeEach(async () => {
  delete process.env.INSTANCE_MODE;
  delete process.env.INSTANCE_SLAVES;
  delete process.env.INSTANCE_SYNC_ALLOW_HTTP;
  await clearTables();
  cleanTmpDir();
});

// ---------------------------------------------------------------------------
// buildSyncPayload
// ---------------------------------------------------------------------------

describe('buildSyncPayload', () => {
  it('returns empty arrays when db has no rows', async () => {
    const payload = await buildSyncPayload();
    expect(payload.data.proxyHosts).toEqual([]);
    expect(payload.data.certificates).toEqual([]);
    expect(payload.data.caCertificates).toEqual([]);
    expect(payload.data.issuedClientCertificates).toEqual([]);
    expect(payload.data.accessLists).toEqual([]);
    expect(payload.data.accessListEntries).toEqual([]);
    expect(payload.data.l4ProxyHosts).toEqual([]);
  });

  it('includes L4 proxy hosts in payload', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ listenAddress: ':5432' }));
    const payload = await buildSyncPayload();
    expect(payload.data.l4ProxyHosts).toHaveLength(1);
    expect(payload.data.l4ProxyHosts![0].listenAddress).toBe(':5432');
  });

  it('sanitizes L4 proxy host ownerUserId to null', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ ownerUserId: null }));
    const payload = await buildSyncPayload();
    expect(payload.data.l4ProxyHosts![0].ownerUserId).toBeNull();
  });

  it('includes multiple L4 proxy hosts', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ name: 'PG', listenAddress: ':5432' }));
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ name: 'MySQL', listenAddress: ':3306' }));
    const payload = await buildSyncPayload();
    expect(payload.data.l4ProxyHosts).toHaveLength(2);
    const addresses = payload.data.l4ProxyHosts!.map(h => h.listenAddress).sort();
    expect(addresses).toEqual([':3306', ':5432']);
  });

  it('returns null settings when no settings are stored', async () => {
    const payload = await buildSyncPayload();
    expect(payload.settings.general).toBeNull();
    expect(payload.settings.acme).toBeNull();
    expect(payload.settings.cloudflare).toBeNull();
    expect(payload.settings.authentik).toBeNull();
    expect(payload.settings.dns).toBeNull();
    expect(payload.settings.waf).toBeNull();
    expect(payload.settings.geoblock).toBeNull();
    expect(payload.settings.trusted_proxies).toBeNull();
    expect(payload.settings.default_response).toBeNull();
  });

  it('includes stored trusted proxies settings in the sync payload', async () => {
    await ctx.db.insert(schema.settings).values({
      key: 'trusted_proxies',
      value: JSON.stringify({ ranges: ['172.21.0.1/32'], strict: true }),
      updatedAt: nowIso(),
    });
    const payload = await buildSyncPayload();
    expect(payload.settings.trusted_proxies).toEqual({ ranges: ['172.21.0.1/32'], strict: true });
  });

  it('includes stored ACME settings in the sync payload', async () => {
    await ctx.db.insert(schema.settings).values({
      key: 'acme',
      value: JSON.stringify({ caUrl: 'https://ca.internal.example.com/acme/acme/directory' }),
      updatedAt: nowIso(),
    });
    const payload = await buildSyncPayload();
    expect(payload.settings.acme).toEqual({ caUrl: 'https://ca.internal.example.com/acme/acme/directory' });
  });

  it('includes stored default response settings in the sync payload', async () => {
    await ctx.db.insert(schema.settings).values({
      key: 'default_response',
      value: JSON.stringify({ mode: 'respond', status: 404, body: 'Not Found' }),
      updatedAt: nowIso(),
    });
    const payload = await buildSyncPayload();
    expect(payload.settings.default_response).toEqual({ mode: 'respond', status: 404, body: 'Not Found' });
  });

  it('includes generated_at as an ISO date string', async () => {
    const before = Date.now();
    const payload = await buildSyncPayload();
    const after = Date.now();
    const ts = new Date(payload.generated_at).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('sanitizes proxy host ownerUserId to null', async () => {
    // buildSyncPayload always spreads ...row then sets ownerUserId: null
    await ctx.db.insert(schema.proxyHosts).values(makeProxyHost());
    const payload = await buildSyncPayload();
    expect(payload.data.proxyHosts).toHaveLength(1);
    expect(payload.data.proxyHosts[0].ownerUserId).toBeNull();
  });

  it('includes proxy host data fields correctly', async () => {
    await ctx.db.insert(schema.proxyHosts).values(
      makeProxyHost({ name: 'My Host', domains: JSON.stringify(['myhost.example.com']) })
    );
    const payload = await buildSyncPayload();
    expect(payload.data.proxyHosts[0].name).toBe('My Host');
    expect(JSON.parse(payload.data.proxyHosts[0].domains)).toEqual(['myhost.example.com']);
  });

  it('sanitizes certificate createdBy to null', async () => {
    const now = nowIso();
    await ctx.db.insert(schema.certificates).values({
      name: 'Test Cert',
      type: 'managed',
      domainNames: JSON.stringify(['cert.example.com']),
      autoRenew: true,
      providerOptions: null,
      certificatePem: null,
      privateKeyPem: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    const payload = await buildSyncPayload();
    expect(payload.data.certificates).toHaveLength(1);
    expect(payload.data.certificates[0].createdBy).toBeNull();
    expect(payload.data.certificates[0].name).toBe('Test Cert');
  });

  it('decrypts certificate keys only for authenticated sync transport', async () => {
    const now = nowIso();
    const privateKeyPem = '-----BEGIN PRIVATE KEY-----\nsync-key-sentinel\n-----END PRIVATE KEY-----';
    await ctx.db.insert(schema.certificates).values({
      name: 'Encrypted Cert',
      type: 'imported',
      domainNames: JSON.stringify(['sync-cert.example.com']),
      autoRenew: false,
      certificatePem: '-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----',
      privateKeyPem: encryptSecret(privateKeyPem),
      createdAt: now,
      updatedAt: now,
    });

    const payload = await buildSyncPayload();
    expect(payload.data.certificates[0].privateKeyPem).toBe(privateKeyPem);

    await applySyncPayload(payload);
    const stored = await ctx.db.query.certificates.findFirst();
    expect(isEncryptedSecret(stored!.privateKeyPem!)).toBe(true);
    expect(decryptSecret(stored!.privateKeyPem!)).toBe(privateKeyPem);
  });

  it('never transports or stores legacy certificate provider secrets', async () => {
    const now = nowIso();
    const providerSecret = 'sync-provider-option-secret-sentinel';
    await ctx.db.insert(schema.certificates).values({
      name: 'Legacy provider options',
      type: 'managed',
      domainNames: JSON.stringify(['provider.example.com']),
      autoRenew: true,
      providerOptions: JSON.stringify({ provider: 'cloudflare', api_token: providerSecret }),
      createdAt: now,
      updatedAt: now,
    });

    const payload = await buildSyncPayload();
    expect(payload.data.certificates[0].providerOptions).toBe('{"provider":"cloudflare"}');
    expect(JSON.stringify(payload)).not.toContain(providerSecret);
  });

  it('sanitizes access list createdBy to null', async () => {
    const now = nowIso();
    await ctx.db.insert(schema.accessLists).values({
      name: 'My List',
      description: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    });
    const payload = await buildSyncPayload();
    expect(payload.data.accessLists).toHaveLength(1);
    expect(payload.data.accessLists[0].createdBy).toBeNull();
    expect(payload.data.accessLists[0].name).toBe('My List');
  });

  it('includes access list entries unchanged', async () => {
    const now = nowIso();
    const [list] = await ctx.db.insert(schema.accessLists).values({
      name: 'List A',
      description: null,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await ctx.db.insert(schema.accessListEntries).values({
      accessListId: list.id,
      username: 'user1',
      passwordHash: '$2b$10$fakehashhhhh',
      createdAt: now,
      updatedAt: now,
    });
    const payload = await buildSyncPayload();
    expect(payload.data.accessListEntries).toHaveLength(1);
    expect(payload.data.accessListEntries[0].username).toBe('user1');
  });
});

describe('syncInstances token policy', () => {
  it('never sends legacy weak plaintext or encrypted target tokens', async () => {
    process.env.INSTANCE_MODE = 'master';
    const now = nowIso();
    await ctx.db.insert(schema.instances).values([
      {
        name: 'Legacy plaintext',
        baseUrl: 'https://plain-slave.example.com',
        apiToken: 'weak-plaintext',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Legacy encrypted',
        baseUrl: 'https://encrypted-slave.example.com',
        apiToken: encryptSecret('weak-encrypted'),
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await syncInstances();

    expect(result).toEqual({ total: 2, success: 0, failed: 2, skippedHttp: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    const rows = await ctx.db.query.instances.findMany();
    expect(rows.every((row) => row.lastSyncError?.includes('security policy'))).toBe(true);
    fetchSpy.mockRestore();
  });

  it('redacts legacy raw sync errors at every API/browser read boundary', async () => {
    const legacySecret = 'legacy-sync-error-secret-sentinel';
    const now = nowIso();
    await ctx.db.insert(schema.instances).values({
      name: 'Legacy error target',
      baseUrl: 'https://legacy.example.com',
      apiToken: encryptSecret('a'.repeat(32)),
      enabled: true,
      lastSyncError: `Sync failed: 500 ${legacySecret}`,
      createdAt: now,
      updatedAt: now,
    });
    await setSetting('instance_last_sync_error', `Caddy rejected: ${legacySecret}`);

    const instances = await listInstances();
    const slaveStatus = await getSlaveLastSync();

    expect(instances[0].lastSyncError).toBe('Previous synchronization failed');
    expect(slaveStatus.error).toBe('Previous synchronization failed');
    expect(JSON.stringify({ instances, slaveStatus })).not.toContain(legacySecret);
  });
});

// ---------------------------------------------------------------------------
// applySyncPayload
// ---------------------------------------------------------------------------

describe('syncInstances transport', () => {
  const STRONG_TOKEN = 'a'.repeat(48);

  async function addSlave() {
    process.env.INSTANCE_MODE = 'master';
    const now = nowIso();
    await ctx.db.insert(schema.instances).values({
      name: 'Slave',
      baseUrl: 'https://slave.example.com',
      apiToken: encryptSecret(STRONG_TOKEN),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  it('does not follow redirects and records a redirect as a failure', async () => {
    await addSlave();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 307, headers: { location: 'http://elsewhere.example/' } })
    );

    const result = await syncInstances();

    expect(result).toMatchObject({ success: 0, failed: 1 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const [row] = await ctx.db.query.instances.findMany();
    expect(row.lastSyncError).toContain('307');
    fetchSpy.mockRestore();
  });

  it('requires an { ok: true } reply, not just a 2xx status', async () => {
    await addSlave();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    );
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });

    fetchSpy.mockResolvedValue(Response.json({ ok: true }));
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    fetchSpy.mockRestore();
  });
});

describe('instance base URL validation', () => {
  it.each([
    ['https://slave.example.com', null],
    ['http://10.0.0.5:3000/cpm', null],
    ['file:///etc/passwd', /https/],
    ['ftp://slave.example.com', /https/],
    ['https://user:pass@slave.example.com', /credentials/],
    ['https://slave.example.com/?x=1', /query/],
    ['not a url', /valid URL/],
  ])('%s', async (url, expected) => {
    const { instanceBaseUrlValidationError } = await import('../../src/lib/models/instances');
    const error = instanceBaseUrlValidationError(url);
    if (expected === null) expect(error).toBeNull();
    else expect(error).toMatch(expected);
  });
});

describe('applySyncPayload', () => {
  /** Build a minimal valid payload (all data empty, all settings null). */
  function emptyPayload(): SyncPayload {
    return {
      generated_at: nowIso(),
      settings: {
        general: null,
        acme: null,
        cloudflare: null,
        dns_provider: null,
        authentik: null,
        metrics: null,
        logging: null,
        dns: null,
        upstream_dns_resolution: null,
        waf: null,
        geoblock: null,
        error_pages: null,
        trusted_proxies: null,
        default_response: null,
      },
      data: {
        certificates: [],
        caCertificates: [],
        issuedClientCertificates: [],
        accessLists: [],
        accessListEntries: [],
        proxyHosts: [],
      },
    };
  }

  it('runs without error on an empty payload', async () => {
    await expect(applySyncPayload(emptyPayload())).resolves.toBeUndefined();
  });

  it('scrubs hostile legacy certificate provider options on inbound sync', async () => {
    const now = nowIso();
    const providerSecret = 'hostile-inbound-provider-secret-sentinel';
    const payload = emptyPayload();
    payload.data.certificates = [
      {
        id: 1,
        name: 'Legacy options',
        type: 'managed',
        domainNames: JSON.stringify(['legacy.example.com']),
        autoRenew: true,
        providerOptions: JSON.stringify({ provider: 'cloudflare', api_token: providerSecret }),
        certificatePem: null,
        privateKeyPem: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 2,
        name: 'Malformed options',
        type: 'managed',
        domainNames: JSON.stringify(['malformed.example.com']),
        autoRenew: true,
        providerOptions: `{not-json-${providerSecret}`,
        certificatePem: null,
        privateKeyPem: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    const rows = await ctx.db.query.certificates.findMany();
    const storedById = new Map(rows.map((row) => [row.id, row]));
    expect(storedById.get(1)?.providerOptions).toBe('{"provider":"cloudflare"}');
    expect(storedById.get(2)?.providerOptions).toBeNull();
    expect(JSON.stringify(rows)).not.toContain(providerSecret);
  });

  it('clears existing proxy hosts when payload has empty array', async () => {
    await ctx.db.insert(schema.proxyHosts).values(makeProxyHost({ name: 'Old Host' }));
    const before = await ctx.db.select().from(schema.proxyHosts);
    expect(before).toHaveLength(1);

    await applySyncPayload(emptyPayload());

    const after = await ctx.db.select().from(schema.proxyHosts);
    expect(after).toHaveLength(0);
  });

  it('inserts proxy hosts from payload', async () => {
    const now = nowIso();
    const payload = emptyPayload();
    payload.data.proxyHosts = [
      {
        id: 1,
        name: 'Synced Host',
        domains: JSON.stringify(['synced.example.com']),
        upstreams: JSON.stringify(['backend:8080']),
        certificateId: null,
        accessListId: null,
        ownerUserId: null,
        sslForced: false,
        hstsEnabled: false,
        hstsSubdomains: false,
        allowWebsocket: false,
        preserveHostHeader: false,
        skipHttpsHostnameValidation: false,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    const rows = await ctx.db.select().from(schema.proxyHosts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Synced Host');
    expect(JSON.parse(rows[0].domains)).toEqual(['synced.example.com']);
  });

  it('replaces existing proxy hosts with payload contents (full override)', async () => {
    await ctx.db.insert(schema.proxyHosts).values(makeProxyHost({ name: 'Old Host' }));

    const now = nowIso();
    const payload = emptyPayload();
    payload.data.proxyHosts = [
      {
        id: 99,
        name: 'New Host',
        domains: JSON.stringify(['new.example.com']),
        upstreams: JSON.stringify(['new-backend:9090']),
        certificateId: null,
        accessListId: null,
        ownerUserId: null,
        sslForced: false,
        hstsEnabled: false,
        hstsSubdomains: false,
        allowWebsocket: false,
        preserveHostHeader: false,
        skipHttpsHostnameValidation: false,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    const rows = await ctx.db.select().from(schema.proxyHosts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('New Host');
  });

  it('is idempotent: applying the same payload twice gives the same result', async () => {
    const now = nowIso();
    const payload = emptyPayload();
    payload.data.proxyHosts = [
      {
        id: 1,
        name: 'Idempotent Host',
        domains: JSON.stringify(['idempotent.example.com']),
        upstreams: JSON.stringify(['backend:8080']),
        certificateId: null,
        accessListId: null,
        ownerUserId: null,
        sslForced: false,
        hstsEnabled: false,
        hstsSubdomains: false,
        allowWebsocket: false,
        preserveHostHeader: false,
        skipHttpsHostnameValidation: false,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);
    await applySyncPayload(payload);

    const rows = await ctx.db.select().from(schema.proxyHosts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Idempotent Host');
  });

  it('stores settings with synced: prefix', async () => {
    const payload = emptyPayload();
    payload.settings.general = { primaryDomain: 'example.com' };

    await applySyncPayload(payload);

    const row = await ctx.db.query.settings.findFirst({
      where: (t, { eq }) => eq(t.key, 'synced:general'),
    });
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toEqual({ primaryDomain: 'example.com' });
  });

  it('stores synced ACME settings with synced: prefix', async () => {
    const payload = emptyPayload();
    payload.settings.acme = { caUrl: 'https://ca.internal.example.com/acme/acme/directory' };

    await applySyncPayload(payload);

    const row = await ctx.db.query.settings.findFirst({
      where: (t, { eq }) => eq(t.key, 'synced:acme'),
    });
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toEqual({ caUrl: 'https://ca.internal.example.com/acme/acme/directory' });
  });

  it('stores synced trusted proxies settings with synced: prefix', async () => {
    const payload = emptyPayload();
    payload.settings.trusted_proxies = { ranges: ['private_ranges'], default_geoblock: true };

    await applySyncPayload(payload);

    const row = await ctx.db.query.settings.findFirst({
      where: (t, { eq }) => eq(t.key, 'synced:trusted_proxies'),
    });
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toEqual({ ranges: ['private_ranges'], default_geoblock: true });
  });

  it('stores synced default response settings with synced: prefix', async () => {
    const payload = emptyPayload();
    payload.settings.default_response = { mode: 'abort' };

    await applySyncPayload(payload);

    const row = await ctx.db.query.settings.findFirst({
      where: (t, { eq }) => eq(t.key, 'synced:default_response'),
    });
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toEqual({ mode: 'abort' });
  });

  it('stores null settings as JSON null value', async () => {
    const payload = emptyPayload();
    payload.settings.cloudflare = null;

    await applySyncPayload(payload);

    const row = await ctx.db.query.settings.findFirst({
      where: (t, { eq }) => eq(t.key, 'synced:cloudflare'),
    });
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toBeNull();
  });

  it('inserts access lists and entries from payload', async () => {
    const now = nowIso();
    const payload = emptyPayload();
    payload.data.accessLists = [
      { id: 1, name: 'Synced List', description: null, createdBy: null, createdAt: now, updatedAt: now },
    ];
    payload.data.accessListEntries = [
      { id: 1, accessListId: 1, username: 'synceduser', passwordHash: '$2b$10$fakehash', createdAt: now, updatedAt: now },
    ];

    await applySyncPayload(payload);

    const lists = await ctx.db.select().from(schema.accessLists);
    expect(lists).toHaveLength(1);
    expect(lists[0].name).toBe('Synced List');

    const entries = await ctx.db.select().from(schema.accessListEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0].username).toBe('synceduser');
  });

  // ---------------------------------------------------------------------------
  // L4 proxy host replication
  // ---------------------------------------------------------------------------

  it('clears existing L4 proxy hosts when payload has empty array', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ name: 'Old L4 Host' }));
    const before = await ctx.db.select().from(schema.l4ProxyHosts);
    expect(before).toHaveLength(1);

    await applySyncPayload(emptyPayload());

    const after = await ctx.db.select().from(schema.l4ProxyHosts);
    expect(after).toHaveLength(0);
  });

  it('inserts L4 proxy hosts from payload', async () => {
    const now = nowIso();
    const payload = emptyPayload();
    payload.data.l4ProxyHosts = [
      {
        id: 1,
        name: 'Synced PG',
        protocol: 'tcp',
        listenAddress: ':5432',
        upstreams: JSON.stringify(['db:5432']),
        matcherType: 'none',
        matcherValue: null,
        tlsTermination: false,
        proxyProtocolVersion: null,
        proxyProtocolReceive: false,
        ownerUserId: null,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    const rows = await ctx.db.select().from(schema.l4ProxyHosts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Synced PG');
    expect(rows[0].listenAddress).toBe(':5432');
  });

  it('replaces existing L4 proxy hosts with payload contents', async () => {
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ name: 'Old L4', listenAddress: ':9999' }));

    const now = nowIso();
    const payload = emptyPayload();
    payload.data.l4ProxyHosts = [
      {
        id: 99,
        name: 'New L4',
        protocol: 'tcp',
        listenAddress: ':5432',
        upstreams: JSON.stringify(['db:5432']),
        matcherType: 'none',
        matcherValue: null,
        tlsTermination: false,
        proxyProtocolVersion: null,
        proxyProtocolReceive: false,
        ownerUserId: null,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    const rows = await ctx.db.select().from(schema.l4ProxyHosts);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('New L4');
    expect(rows[0].listenAddress).toBe(':5432');
  });

  it('works with payload missing l4ProxyHosts (backward compat with old master)', async () => {
    // Old master instances don't include l4ProxyHosts in their payload.
    // The slave should still sync successfully and not crash.
    await ctx.db.insert(schema.l4ProxyHosts).values(makeL4Host({ name: 'Existing L4' }));

    const payload = emptyPayload();
    // Explicitly remove l4ProxyHosts to simulate old master payload
    delete (payload.data as Record<string, unknown>).l4ProxyHosts;

    await expect(applySyncPayload(payload)).resolves.toBeUndefined();

    // Existing L4 hosts are cleared (the DELETE always runs)
    const rows = await ctx.db.select().from(schema.l4ProxyHosts);
    expect(rows).toHaveLength(0);
  });

  it('writes trigger file when L4 port diff requires apply after sync', async () => {
    const now = nowIso();
    const payload = emptyPayload();
    payload.data.l4ProxyHosts = [
      {
        id: 1,
        name: 'PG Sync',
        protocol: 'tcp',
        listenAddress: ':5432',
        upstreams: JSON.stringify(['db:5432']),
        matcherType: 'none',
        matcherValue: null,
        tlsTermination: false,
        proxyProtocolVersion: null,
        proxyProtocolReceive: false,
        ownerUserId: null,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    // No override file exists yet → diff will show needsApply=true
    await applySyncPayload(payload);

    const triggerPath = join(ctx.tmpDir, 'l4-ports.trigger');
    expect(existsSync(triggerPath)).toBe(true);
  });

  it('does not write trigger file when L4 ports already match after sync', async () => {
    const { writeFileSync } = await import('node:fs');
    // Pre-write override file matching the incoming payload port
    writeFileSync(join(ctx.tmpDir, 'docker-compose.l4-ports.yml'), `services:\n  caddy:\n    ports:\n      - "5432:5432"\n`);

    const now = nowIso();
    const payload = emptyPayload();
    payload.data.l4ProxyHosts = [
      {
        id: 1,
        name: 'PG Sync',
        protocol: 'tcp',
        listenAddress: ':5432',
        upstreams: JSON.stringify(['db:5432']),
        matcherType: 'none',
        matcherValue: null,
        tlsTermination: false,
        proxyProtocolVersion: null,
        proxyProtocolReceive: false,
        ownerUserId: null,
        meta: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    await applySyncPayload(payload);

    // Ports already match → no trigger needed
    const triggerPath = join(ctx.tmpDir, 'l4-ports.trigger');
    expect(existsSync(triggerPath)).toBe(false);
  });
});
