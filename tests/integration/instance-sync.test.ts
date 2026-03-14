/**
 * Integration tests for buildSyncPayload and applySyncPayload
 * in src/lib/instance-sync.ts.
 *
 * We mock src/lib/db.ts to inject a fresh migrated in-memory SQLite
 * database, giving full control over table content without affecting
 * any real db file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TestDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Mock src/lib/db — must be declared before any import that uses the db.
// vi.hoisted() creates the mutable container at hoist time so the vi.mock
// factory (which also runs during hoisting) can populate it safely.
// ---------------------------------------------------------------------------

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

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
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.accessListEntries);
  await ctx.db.delete(schema.accessLists);
  await ctx.db.delete(schema.issuedClientCertificates);
  await ctx.db.delete(schema.certificates);
  await ctx.db.delete(schema.caCertificates);
  await ctx.db.delete(schema.settings);
}

beforeEach(async () => {
  await clearTables();
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
        authentik: null,
        metrics: null,
        logging: null,
        dns: null,
        upstream_dns_resolution: null,
        waf: null,
        geoblock: null,
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
});
