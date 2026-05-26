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
import { buildSyncPayload, applySyncPayload, type SyncPayload } from '../../src/lib/instance-sync';
import * as schema from '../../src/lib/db/schema';

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
    expect(payload.settings.cloudflare).toBeNull();
    expect(payload.settings.authentik).toBeNull();
    expect(payload.settings.dns).toBeNull();
    expect(payload.settings.waf).toBeNull();
    expect(payload.settings.geoblock).toBeNull();
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

// ---------------------------------------------------------------------------
// applySyncPayload
// ---------------------------------------------------------------------------

describe('applySyncPayload', () => {
  /** Build a minimal valid payload (all data empty, all settings null). */
  function emptyPayload(): SyncPayload {
    return {
      generated_at: nowIso(),
      settings: {
        general: null,
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
