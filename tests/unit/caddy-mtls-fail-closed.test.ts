/**
 * Regression: mTLS must FAIL CLOSED when a host has mTLS enabled but no trust
 * resolves to an active client certificate — e.g. trust is role-only and every
 * cert in the role has been revoked (or the role is empty).
 *
 * Bug (SECURITY-AUDIT H2): such a host was silently dropped from mTlsDomainMap,
 * so buildTlsConnectionPolicies emitted a plain TLS policy with no
 * client_authentication block — the backend was served to ANY client with no
 * certificate required. The fix keeps the domain in the map (empty CA set →
 * drop-all policy) and forces require_and_verify even for protected/excluded
 * path configs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Keep the real buildCaddyDocument; stub only the network apply.
vi.mock('../../src/lib/caddy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/caddy')>();
  return { ...actual, applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }) };
});

vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

import { createProxyHost } from '../../src/lib/models/proxy-hosts';
import { buildCaddyDocument } from '../../src/lib/caddy';
import * as schema from '../../src/lib/db/schema';

const EMPTY_ROLE_ID = 999; // a role with no active certs (simulates all-revoked / empty role)

/** Collect every TLS connection policy from the document. */
function collectConnectionPolicies(doc: unknown): Record<string, unknown>[] {
  const servers = (doc as { apps?: { http?: { servers?: Record<string, { tls_connection_policies?: Record<string, unknown>[] }> } } })
    ?.apps?.http?.servers ?? {};
  const out: Record<string, unknown>[] = [];
  for (const server of Object.values(servers)) {
    for (const p of server.tls_connection_policies ?? []) out.push(p);
  }
  return out;
}

function policyForDomain(doc: unknown, domain: string): Record<string, unknown> | undefined {
  return collectConnectionPolicies(doc).find((p) => {
    const sni = (p.match as { sni?: string[] } | undefined)?.sni;
    return Array.isArray(sni) && sni.includes(domain);
  });
}

/** A fail-closed policy either drops the connection or requires (and verifies) a client cert. */
function isFailClosed(policy: Record<string, unknown> | undefined): boolean {
  if (!policy) return false;
  if (policy.drop === true) return true;
  const ca = policy.client_authentication as { mode?: string } | undefined;
  return Boolean(ca) && ca!.mode !== 'request';
}

beforeEach(async () => {
  await ctx.db.delete(schema.proxyHosts);
  await ctx.db.delete(schema.users).catch(() => {});
  await ctx.db.insert(schema.users).values({
    id: 1,
    email: 'admin@example.com',
    name: 'Admin',
    role: 'admin',
    provider: 'credentials',
    subject: 'admin',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

describe('mTLS fail-closed when trust resolves to zero active certs', () => {
  it('emits a deny-all/drop policy (not a plain no-auth policy) for a role with no active certs', async () => {
    const domain = 'role-empty.example.com';
    await createProxyHost(
      {
        name: 'role-empty',
        domains: [domain],
        upstreams: ['10.0.0.5:8080'],
        mtls: { enabled: true, trusted_role_ids: [EMPTY_ROLE_ID] },
      },
      1
    );

    const doc = await buildCaddyDocument();
    const policy = policyForDomain(doc, domain);

    // The domain MUST have a connection policy and it MUST be fail-closed.
    expect(policy, 'domain should still have a TLS connection policy').toBeDefined();
    expect(isFailClosed(policy)).toBe(true);
    // Explicitly: it must not be a bare policy that lets every client through.
    expect(policy!.drop === true || policy!.client_authentication !== undefined).toBe(true);
  });

  it('fails closed even with protected_paths (does not fall back to optional "request" mode)', async () => {
    const domain = 'role-empty-protected.example.com';
    await createProxyHost(
      {
        name: 'role-empty-protected',
        domains: [domain],
        upstreams: ['10.0.0.5:8080'],
        mtls: { enabled: true, trusted_role_ids: [EMPTY_ROLE_ID], protected_paths: ['/admin/*'] },
      },
      1
    );

    const doc = await buildCaddyDocument();
    const policy = policyForDomain(doc, domain);

    expect(policy).toBeDefined();
    // Must NOT be "request" (optional) mode, which would accept any presented cert.
    const ca = policy!.client_authentication as { mode?: string } | undefined;
    expect(ca?.mode).not.toBe('request');
    expect(isFailClosed(policy)).toBe(true);
  });

  it('rejects enabling mTLS with no trusted certs, roles, or CAs (model guard)', async () => {
    await expect(
      createProxyHost(
        {
          name: 'mtls-no-trust',
          domains: ['no-trust.example.com'],
          upstreams: ['10.0.0.5:8080'],
          mtls: { enabled: true },
        },
        1
      )
    ).rejects.toThrow(/no trusted client certificates, roles, or CA/i);
  });

  it('does not emit a drop policy for a plain (non-mTLS) host', async () => {
    const domain = 'plain.example.com';
    await createProxyHost(
      { name: 'plain', domains: [domain], upstreams: ['10.0.0.5:8080'] },
      1
    );

    const doc = await buildCaddyDocument();
    const policy = policyForDomain(doc, domain);
    // A plain host may or may not have an explicit policy, but it must never be
    // dropped or carry a client_authentication requirement.
    if (policy) {
      expect(policy.drop).not.toBe(true);
      expect(policy.client_authentication).toBeUndefined();
    }
  });

  // M4: revoking the host's only directly-trusted cert must NOT broaden trust to
  // other active certs of the same CA that were never assigned to the host.
  it('does not fall back to whole-CA trust when the directly-trusted cert is revoked', async () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 86_400_000).toISOString();
    await ctx.db.delete(schema.issuedClientCertificates).catch(() => {});
    await ctx.db.delete(schema.caCertificates).catch(() => {});
    await ctx.db.insert(schema.caCertificates).values({
      id: 1, name: 'CA X', certificatePem: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
      privateKeyPem: null, createdAt: now, updatedAt: now,
    });
    // Cert A: assigned to the host, then REVOKED.
    await ctx.db.insert(schema.issuedClientCertificates).values({
      id: 1, caCertificateId: 1, commonName: 'alice', serialNumber: '01', fingerprintSha256: 'aa',
      certificatePem: '-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----',
      validFrom: now, validTo: later, revokedAt: now, createdAt: now, updatedAt: now,
    });
    // Cert B: a sibling cert of the SAME CA, still active, never assigned here.
    await ctx.db.insert(schema.issuedClientCertificates).values({
      id: 2, caCertificateId: 1, commonName: 'bob', serialNumber: '02', fingerprintSha256: 'bb',
      certificatePem: '-----BEGIN CERTIFICATE-----\nB\n-----END CERTIFICATE-----',
      validFrom: now, validTo: later, revokedAt: null, createdAt: now, updatedAt: now,
    });

    const domain = 'm4.example.com';
    await createProxyHost(
      {
        name: 'm4-host',
        domains: [domain],
        upstreams: ['10.0.0.5:8080'],
        mtls: { enabled: true, trusted_client_cert_ids: [1] },
      },
      1
    );

    const doc = await buildCaddyDocument();
    const policy = policyForDomain(doc, domain);

    expect(policy, 'domain must still have a policy').toBeDefined();
    // Must fail closed (drop) — NOT trust sibling cert B via a whole-CA fallback.
    expect(policy!.drop).toBe(true);
    expect(JSON.stringify(policy)).not.toContain('CERTIFICATE'); // no trusted leaf/CA certs leaked in
  });
});
