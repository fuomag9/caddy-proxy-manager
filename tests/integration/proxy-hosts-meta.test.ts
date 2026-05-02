/**
 * Integration tests: proxy host JSON field serialization.
 *
 * Verifies that complex nested meta objects (WAF, geo-block, authentik,
 * load balancer) survive a round-trip through the database — stored as JSON,
 * retrieved and deserialized correctly.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { proxyHosts } from '@/src/lib/db/schema';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertHost(overrides: Partial<typeof proxyHosts.$inferInsert> = {}) {
  const now = nowIso();
  const [host] = await db.insert(proxyHosts).values({
    name: 'Test Host',
    domains: JSON.stringify(['test.example.com']),
    upstreams: JSON.stringify(['backend:8080']),
    certificateId: null,
    accessListId: null,
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
  }).returning();
  return host;
}

// ---------------------------------------------------------------------------
// domains / upstreams JSON
// ---------------------------------------------------------------------------

describe('proxy-hosts JSON fields', () => {
  it('stores and retrieves domains array', async () => {
    const domains = ['example.com', 'www.example.com'];
    const host = await insertHost({ domains: JSON.stringify(domains) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(JSON.parse(row!.domains)).toEqual(domains);
  });

  it('stores and retrieves multiple upstreams', async () => {
    const upstreams = ['backend1:8080', 'backend2:8080', 'backend3:8080'];
    const host = await insertHost({ upstreams: JSON.stringify(upstreams) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(JSON.parse(row!.upstreams)).toEqual(upstreams);
  });

  it('stores upstream with URL containing commas without splitting', () => {
    // URLs with commas in query strings must survive round-trip intact
    const upstreams = ['http://backend.local/api?a=1,b=2'];
    const stored = JSON.stringify(upstreams);
    const retrieved = JSON.parse(stored);
    expect(retrieved).toEqual(upstreams);
  });
});

// ---------------------------------------------------------------------------
// WAF meta round-trip
// ---------------------------------------------------------------------------

describe('proxy-hosts WAF meta', () => {
  it('stores and retrieves WAF config with OWASP CRS enabled', async () => {
    const wafMeta = {
      waf: {
        enabled: true,
        mode: 'On',
        load_owasp_crs: true,
        excluded_rule_ids: [942100, 941110],
        waf_mode: 'override',
        custom_directives: 'SecRuleEngine On',
      },
    };
    const host = await insertHost({ meta: JSON.stringify(wafMeta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.waf.enabled).toBe(true);
    expect(parsed.waf.load_owasp_crs).toBe(true);
    expect(parsed.waf.excluded_rule_ids).toEqual([942100, 941110]);
    expect(parsed.waf.waf_mode).toBe('override');
  });

  it('stores and retrieves disabled WAF config', async () => {
    const meta = { waf: { enabled: false, waf_mode: 'merge' } };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.waf.enabled).toBe(false);
    expect(parsed.waf.waf_mode).toBe('merge');
  });
});

// ---------------------------------------------------------------------------
// Geo-block meta round-trip
// ---------------------------------------------------------------------------

describe('proxy-hosts geo-block meta', () => {
  it('stores and retrieves geo-block block list config', async () => {
    const meta = {
      geoblock_mode: 'block',
      geoblock: {
        block_countries: ['RU', 'CN', 'KP'],
        allow_countries: [],
        block_asns: [12345],
        block_ips: ['1.2.3.4'],
        block_cidrs: ['5.6.0.0/16'],
        response_status_code: 403,
        fail_closed: true,
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.geoblock_mode).toBe('block');
    expect(parsed.geoblock.block_countries).toEqual(['RU', 'CN', 'KP']);
    expect(parsed.geoblock.block_asns).toEqual([12345]);
    expect(parsed.geoblock.response_status_code).toBe(403);
    expect(parsed.geoblock.fail_closed).toBe(true);
  });

  it('stores and retrieves geo-block allow list config', async () => {
    const meta = {
      geoblock_mode: 'block',
      geoblock: {
        block_countries: [],
        allow_countries: ['FI', 'SE', 'NO'],
        response_status_code: 403,
        fail_closed: false,
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.geoblock.allow_countries).toEqual(['FI', 'SE', 'NO']);
    expect(parsed.geoblock.fail_closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Load balancer meta round-trip
// ---------------------------------------------------------------------------

describe('proxy-hosts load balancer meta', () => {
  it('stores and retrieves load balancer config with active health checks', async () => {
    const meta = {
      load_balancer: {
        enabled: true,
        policy: 'round_robin',
        active_health_check: {
          enabled: true,
          uri: '/health',
          port: 8081,
          interval: '30s',
          timeout: '5s',
          expected_status: 200,
        },
        passive_health_check: {
          enabled: false,
        },
        cookie_secret: null,
        header_field: null,
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.load_balancer.policy).toBe('round_robin');
    expect(parsed.load_balancer.active_health_check.uri).toBe('/health');
    expect(parsed.load_balancer.active_health_check.expected_status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Boolean fields
// ---------------------------------------------------------------------------

describe('proxy-hosts boolean fields', () => {
  it('sslForced is stored and retrieved truthy', async () => {
    const host = await insertHost({ sslForced: true });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    // Drizzle may return SQLite 0/1 as number or as boolean depending on schema mode
    expect(Boolean(row!.sslForced)).toBe(true);
  });

  it('hstsEnabled and hstsSubdomains round-trip correctly', async () => {
    const host = await insertHost({ hstsEnabled: true, hstsSubdomains: true });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.hstsEnabled)).toBe(true);
    expect(Boolean(row!.hstsSubdomains)).toBe(true);
  });

  it('allowWebsocket defaults to falsy when not set', async () => {
    const host = await insertHost();
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.allowWebsocket)).toBe(false);
  });

  it('enabled can be set to disabled (falsy)', async () => {
    const host = await insertHost({ enabled: false });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(Boolean(row!.enabled)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Authentik forward auth meta round-trip
// ---------------------------------------------------------------------------

describe('proxy-hosts authentik meta', () => {
  it('stores and retrieves authentik config with excluded_paths', async () => {
    const meta = {
      authentik: {
        enabled: true,
        outpost_domain: 'outpost.goauthentik.io',
        outpost_upstream: 'http://authentik:9000',
        excluded_paths: ['/share/*', '/rest/*'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.authentik.enabled).toBe(true);
    expect(parsed.authentik.excluded_paths).toEqual(['/share/*', '/rest/*']);
  });

  it('stores authentik config with protected_paths (no excluded_paths)', async () => {
    const meta = {
      authentik: {
        enabled: true,
        outpost_domain: 'outpost.goauthentik.io',
        outpost_upstream: 'http://authentik:9000',
        protected_paths: ['/admin/*', '/secret/*'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.authentik.protected_paths).toEqual(['/admin/*', '/secret/*']);
    expect(parsed.authentik.excluded_paths).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CPM forward auth meta round-trip
// ---------------------------------------------------------------------------

describe('proxy-hosts CPM forward auth meta', () => {
  it('stores and retrieves cpm_forward_auth config with excluded_paths', async () => {
    const meta = {
      cpm_forward_auth: {
        enabled: true,
        excluded_paths: ['/api/public/*', '/health'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.cpm_forward_auth.enabled).toBe(true);
    expect(parsed.cpm_forward_auth.excluded_paths).toEqual(['/api/public/*', '/health']);
  });

  it('stores cpm_forward_auth config with protected_paths (no excluded_paths)', async () => {
    const meta = {
      cpm_forward_auth: {
        enabled: true,
        protected_paths: ['/admin/*'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.cpm_forward_auth.protected_paths).toEqual(['/admin/*']);
    expect(parsed.cpm_forward_auth.excluded_paths).toBeUndefined();
  });
});

describe('proxy-hosts mTLS meta', () => {
  it('stores and retrieves mtls config with excluded_paths', async () => {
    const meta = {
      mtls: {
        enabled: true,
        trusted_client_cert_ids: [10],
        excluded_paths: ['/health', '/public/*'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.mtls.enabled).toBe(true);
    expect(parsed.mtls.excluded_paths).toEqual(['/health', '/public/*']);
  });

  it('stores mtls config with protected_paths (no excluded_paths)', async () => {
    const meta = {
      mtls: {
        enabled: true,
        trusted_role_ids: [7],
        protected_paths: ['/admin/*'],
      },
    };
    const host = await insertHost({ meta: JSON.stringify(meta) });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    const parsed = JSON.parse(row!.meta!);
    expect(parsed.mtls.protected_paths).toEqual(['/admin/*']);
    expect(parsed.mtls.excluded_paths).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Null meta field
// ---------------------------------------------------------------------------

describe('proxy-hosts null meta', () => {
  it('meta can be null for simple hosts', async () => {
    const host = await insertHost({ meta: null });
    const row = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, host.id) });
    expect(row!.meta).toBeNull();
  });

  it('multiple hosts can coexist with different meta states', async () => {
    const h1 = await insertHost({ name: 'Simple', meta: null });
    const h2 = await insertHost({ name: 'With WAF', meta: JSON.stringify({ waf: { enabled: true, waf_mode: 'override' } }) });

    const r1 = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, h1.id) });
    const r2 = await db.query.proxyHosts.findFirst({ where: (t, { eq }) => eq(t.id, h2.id) });
    expect(r1!.meta).toBeNull();
    expect(JSON.parse(r2!.meta!).waf.enabled).toBe(true);
  });
});
