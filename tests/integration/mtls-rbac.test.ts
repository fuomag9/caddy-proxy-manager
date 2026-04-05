import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  mtlsRoles,
  mtlsCertificateRoles,
  mtlsAccessRules,
  issuedClientCertificates,
  caCertificates,
  proxyHosts,
} from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertCaCert(name = 'Test CA') {
  const now = nowIso();
  const [ca] = await db.insert(caCertificates).values({
    name,
    certificatePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
    createdAt: now,
    updatedAt: now,
  }).returning();
  return ca;
}

async function insertClientCert(caCertId: number, cn = 'test-client', fingerprint = 'AABB') {
  const now = nowIso();
  const [cert] = await db.insert(issuedClientCertificates).values({
    caCertificateId: caCertId,
    commonName: cn,
    serialNumber: Date.now().toString(16),
    fingerprintSha256: fingerprint,
    certificatePem: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
    validFrom: now,
    validTo: now,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return cert;
}

async function insertRole(name = 'admin') {
  const now = nowIso();
  const [role] = await db.insert(mtlsRoles).values({
    name,
    description: null,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return role;
}

async function insertProxyHost(name = 'test-host') {
  const now = nowIso();
  const [host] = await db.insert(proxyHosts).values({
    name,
    domains: '["test.example.com"]',
    upstreams: '["http://localhost:8080"]',
    meta: JSON.stringify({ mtls: { enabled: true, ca_certificate_ids: [1] } }),
    createdAt: now,
    updatedAt: now,
  }).returning();
  return host;
}

// ── mtlsRoles ────────────────────────────────────────────────────────

describe('mtls_roles table', () => {
  it('creates a role with unique name', async () => {
    const role = await insertRole('admin');
    expect(role.name).toBe('admin');
    expect(role.id).toBeGreaterThan(0);
  });

  it('enforces unique name constraint', async () => {
    await insertRole('admin');
    await expect(insertRole('admin')).rejects.toThrow();
  });

  it('supports description field', async () => {
    const now = nowIso();
    const [role] = await db.insert(mtlsRoles).values({
      name: 'viewer',
      description: 'Read-only access',
      createdAt: now,
      updatedAt: now,
    }).returning();
    expect(role.description).toBe('Read-only access');
  });
});

// ── mtlsCertificateRoles ─────────────────────────────────────────────

describe('mtls_certificate_roles table', () => {
  it('assigns a cert to a role', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const role = await insertRole();

    const now = nowIso();
    const [assignment] = await db.insert(mtlsCertificateRoles).values({
      issuedClientCertificateId: cert.id,
      mtlsRoleId: role.id,
      createdAt: now,
    }).returning();

    expect(assignment.issuedClientCertificateId).toBe(cert.id);
    expect(assignment.mtlsRoleId).toBe(role.id);
  });

  it('enforces unique constraint on (cert, role) pair', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const role = await insertRole();
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({
      issuedClientCertificateId: cert.id,
      mtlsRoleId: role.id,
      createdAt: now,
    });

    await expect(
      db.insert(mtlsCertificateRoles).values({
        issuedClientCertificateId: cert.id,
        mtlsRoleId: role.id,
        createdAt: now,
      })
    ).rejects.toThrow();
  });

  it('cascades on role deletion', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const role = await insertRole();
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({
      issuedClientCertificateId: cert.id,
      mtlsRoleId: role.id,
      createdAt: now,
    });

    await db.delete(mtlsRoles).where(eq(mtlsRoles.id, role.id));

    const remaining = await db.select().from(mtlsCertificateRoles);
    expect(remaining.length).toBe(0);
  });

  it('cascades on cert deletion', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const role = await insertRole();
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({
      issuedClientCertificateId: cert.id,
      mtlsRoleId: role.id,
      createdAt: now,
    });

    await db.delete(issuedClientCertificates).where(eq(issuedClientCertificates.id, cert.id));

    const remaining = await db.select().from(mtlsCertificateRoles);
    expect(remaining.length).toBe(0);
  });
});

// ── mtlsAccessRules ──────────────────────────────────────────────────

describe('mtls_access_rules table', () => {
  it('creates an access rule for a proxy host', async () => {
    const host = await insertProxyHost();
    const now = nowIso();
    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/admin/*',
      allowedRoleIds: JSON.stringify([1, 2]),
      allowedCertIds: JSON.stringify([]),
      denyAll: false,
      priority: 10,
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule.pathPattern).toBe('/admin/*');
    expect(rule.priority).toBe(10);
    expect(JSON.parse(rule.allowedRoleIds)).toEqual([1, 2]);
  });

  it('enforces unique (proxyHostId, pathPattern)', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/admin/*',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      db.insert(mtlsAccessRules).values({
        proxyHostId: host.id,
        pathPattern: '/admin/*',
        createdAt: now,
        updatedAt: now,
      })
    ).rejects.toThrow();
  });

  it('allows same path on different hosts', async () => {
    const host1 = await insertProxyHost('host-1');
    const host2 = await insertProxyHost('host-2');
    const now = nowIso();

    await db.insert(mtlsAccessRules).values({
      proxyHostId: host1.id,
      pathPattern: '/admin/*',
      createdAt: now,
      updatedAt: now,
    });

    const [rule2] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host2.id,
      pathPattern: '/admin/*',
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule2.proxyHostId).toBe(host2.id);
  });

  it('cascades on proxy host deletion', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/admin/*',
      createdAt: now,
      updatedAt: now,
    });

    await db.delete(proxyHosts).where(eq(proxyHosts.id, host.id));

    const remaining = await db.select().from(mtlsAccessRules);
    expect(remaining.length).toBe(0);
  });

  it('stores deny_all flag correctly', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/blocked/*',
      denyAll: true,
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule.denyAll).toBe(true);
  });

  it('defaults allowed_role_ids and allowed_cert_ids to "[]"', async () => {
    const host = await insertProxyHost();
    const now = nowIso();
    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/test',
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule.allowedRoleIds).toBe('[]');
    expect(rule.allowedCertIds).toBe('[]');
  });

  it('defaults deny_all to false and priority to 0', async () => {
    const host = await insertProxyHost();
    const now = nowIso();
    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/test',
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule.denyAll).toBe(false);
    expect(rule.priority).toBe(0);
  });

  it('stores JSON arrays with numbers in allowed_role_ids', async () => {
    const host = await insertProxyHost();
    const now = nowIso();
    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/test',
      allowedRoleIds: JSON.stringify([1, 2, 3]),
      allowedCertIds: JSON.stringify([10, 20]),
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(JSON.parse(rule.allowedRoleIds)).toEqual([1, 2, 3]);
    expect(JSON.parse(rule.allowedCertIds)).toEqual([10, 20]);
  });

  it('supports description field', async () => {
    const host = await insertProxyHost();
    const now = nowIso();
    const [rule] = await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/test',
      description: 'Only for admins',
      createdAt: now,
      updatedAt: now,
    }).returning();

    expect(rule.description).toBe('Only for admins');
  });

  it('supports multiple rules with different priorities on same host', async () => {
    const host = await insertProxyHost();
    const now = nowIso();

    await db.insert(mtlsAccessRules).values({ proxyHostId: host.id, pathPattern: '/a', priority: 1, createdAt: now, updatedAt: now });
    await db.insert(mtlsAccessRules).values({ proxyHostId: host.id, pathPattern: '/b', priority: 100, createdAt: now, updatedAt: now });
    await db.insert(mtlsAccessRules).values({ proxyHostId: host.id, pathPattern: '/c', priority: 50, createdAt: now, updatedAt: now });

    const rows = await db.select().from(mtlsAccessRules);
    expect(rows).toHaveLength(3);
  });
});

// ── Additional schema relationship tests ─────────────────────────────

describe('cross-table relationships', () => {
  it('cascades CA deletion through issued certs to certificate_roles', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const role = await insertRole();
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({
      issuedClientCertificateId: cert.id,
      mtlsRoleId: role.id,
      createdAt: now,
    });

    // Delete the CA — should cascade: CA → issued certs → cert_roles
    await db.delete(caCertificates).where(eq(caCertificates.id, ca.id));

    const remainingCerts = await db.select().from(issuedClientCertificates);
    expect(remainingCerts).toHaveLength(0);

    const remainingAssignments = await db.select().from(mtlsCertificateRoles);
    expect(remainingAssignments).toHaveLength(0);

    // The role itself should still exist
    const remainingRoles = await db.select().from(mtlsRoles);
    expect(remainingRoles).toHaveLength(1);
  });

  it('allows a cert to be assigned to multiple roles simultaneously', async () => {
    const ca = await insertCaCert();
    const cert = await insertClientCert(ca.id);
    const r1 = await insertRole('role-a');
    const r2 = await insertRole('role-b');
    const r3 = await insertRole('role-c');
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert.id, mtlsRoleId: r1.id, createdAt: now });
    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert.id, mtlsRoleId: r2.id, createdAt: now });
    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert.id, mtlsRoleId: r3.id, createdAt: now });

    const assignments = await db.select().from(mtlsCertificateRoles);
    expect(assignments).toHaveLength(3);
  });

  it('allows multiple certs to be assigned to the same role', async () => {
    const ca = await insertCaCert();
    const cert1 = await insertClientCert(ca.id, 'alice', 'AA');
    const cert2 = await insertClientCert(ca.id, 'bob', 'BB');
    const cert3 = await insertClientCert(ca.id, 'charlie', 'CC');
    const role = await insertRole();
    const now = nowIso();

    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert1.id, mtlsRoleId: role.id, createdAt: now });
    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert2.id, mtlsRoleId: role.id, createdAt: now });
    await db.insert(mtlsCertificateRoles).values({ issuedClientCertificateId: cert3.id, mtlsRoleId: role.id, createdAt: now });

    const assignments = await db.select().from(mtlsCertificateRoles).where(eq(mtlsCertificateRoles.mtlsRoleId, role.id));
    expect(assignments).toHaveLength(3);
  });

  it('role deletion does not affect proxy host access rules referencing the role', async () => {
    const host = await insertProxyHost();
    const role = await insertRole();
    const now = nowIso();

    // Create an access rule that references this role
    await db.insert(mtlsAccessRules).values({
      proxyHostId: host.id,
      pathPattern: '/test',
      allowedRoleIds: JSON.stringify([role.id]),
      createdAt: now,
      updatedAt: now,
    });

    // Delete the role — the access rule should still exist (JSON array, no FK)
    await db.delete(mtlsRoles).where(eq(mtlsRoles.id, role.id));

    const rules = await db.select().from(mtlsAccessRules);
    expect(rules).toHaveLength(1);
    // The role ID is still in the JSON, but the role no longer exists
    expect(JSON.parse(rules[0].allowedRoleIds)).toEqual([role.id]);
  });
});
