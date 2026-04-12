/**
 * Integration tests for src/lib/models/mtls-roles.ts
 * Tests all CRUD operations and the fingerprint/cert-id map builders
 * using a real in-memory SQLite database.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import {
  issuedClientCertificates,
  caCertificates,
  users,
} from '../../src/lib/db/schema';

let db: TestDb;

// Mock the modules that mtls-roles.ts imports
vi.mock('../../src/lib/db', async () => {
  // This gets re-evaluated per test via beforeEach
  return {
    get default() { return db; },
    nowIso: () => new Date().toISOString(),
    toIso: (v: string | null) => v,
  };
});
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig: vi.fn() }));
vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));

let userId: number;

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
  // Seed a user to satisfy FK constraints on createdBy
  const now = new Date().toISOString();
  const [user] = await db.insert(users).values({
    email: 'admin@test', name: 'Admin', role: 'admin',
    provider: 'credentials', subject: 'admin@test', status: 'active',
    createdAt: now, updatedAt: now,
  }).returning();
  userId = user.id;
});

function nowIso() { return new Date().toISOString(); }

async function seedCaAndCerts() {
  const now = nowIso();
  const [ca] = await db.insert(caCertificates).values({
    name: 'Test CA',
    certificatePem: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
    createdAt: now, updatedAt: now,
  }).returning();

  const [cert1] = await db.insert(issuedClientCertificates).values({
    caCertificateId: ca.id, commonName: 'alice', serialNumber: '001',
    fingerprintSha256: 'AA:BB:CC:DD', certificatePem: '-----BEGIN CERTIFICATE-----\nALICE\n-----END CERTIFICATE-----',
    validFrom: now, validTo: now, createdAt: now, updatedAt: now,
  }).returning();

  const [cert2] = await db.insert(issuedClientCertificates).values({
    caCertificateId: ca.id, commonName: 'bob', serialNumber: '002',
    fingerprintSha256: 'EE:FF:00:11', certificatePem: '-----BEGIN CERTIFICATE-----\nBOB\n-----END CERTIFICATE-----',
    validFrom: now, validTo: now, createdAt: now, updatedAt: now,
  }).returning();

  const [revokedCert] = await db.insert(issuedClientCertificates).values({
    caCertificateId: ca.id, commonName: 'revoked-user', serialNumber: '003',
    fingerprintSha256: '99:88:77:66', certificatePem: '-----BEGIN CERTIFICATE-----\nREVOKED\n-----END CERTIFICATE-----',
    validFrom: now, validTo: now, revokedAt: now, createdAt: now, updatedAt: now,
  }).returning();

  return { ca, cert1, cert2, revokedCert };
}

// Dynamically import after mocks are set up
const {
  listMtlsRoles,
  getMtlsRole,
  createMtlsRole,
  updateMtlsRole,
  deleteMtlsRole,
  assignRoleToCertificate,
  removeRoleFromCertificate,
  getCertificateRoles,
  buildRoleFingerprintMap,
  buildCertFingerprintMap,
  buildRoleCertIdMap,
} = await import('../../src/lib/models/mtls-roles');

describe('mtls-roles model CRUD', () => {
  it('createMtlsRole creates a role and returns it', async () => {
    const role = await createMtlsRole({ name: 'admin', description: 'Admin role' }, userId);
    expect(role.name).toBe('admin');
    expect(role.description).toBe('Admin role');
    expect(role.certificateCount).toBe(0);
    expect(role.id).toBeGreaterThan(0);
  });

  it('createMtlsRole trims whitespace', async () => {
    const role = await createMtlsRole({ name: '  padded  ' }, userId);
    expect(role.name).toBe('padded');
  });

  it('listMtlsRoles returns all roles sorted by name', async () => {
    await createMtlsRole({ name: 'zebra' }, userId);
    await createMtlsRole({ name: 'alpha' }, userId);
    const roles = await listMtlsRoles();
    expect(roles.length).toBe(2);
    expect(roles[0].name).toBe('alpha');
    expect(roles[1].name).toBe('zebra');
  });

  it('listMtlsRoles includes certificate counts', async () => {
    const { cert1 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);

    const roles = await listMtlsRoles();
    expect(roles[0].certificateCount).toBe(1);
  });

  it('listMtlsRoles returns empty array when no roles', async () => {
    const roles = await listMtlsRoles();
    expect(roles).toEqual([]);
  });

  it('getMtlsRole returns role with certificateIds', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await assignRoleToCertificate(role.id, cert2.id, 1);

    const fetched = await getMtlsRole(role.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.certificateIds).toHaveLength(2);
    expect(fetched!.certificateIds).toContain(cert1.id);
    expect(fetched!.certificateIds).toContain(cert2.id);
  });

  it('getMtlsRole returns null for non-existent role', async () => {
    const result = await getMtlsRole(999);
    expect(result).toBeNull();
  });

  it('updateMtlsRole updates name and description', async () => {
    const role = await createMtlsRole({ name: 'old', description: 'old desc' }, userId);
    const updated = await updateMtlsRole(role.id, { name: 'new', description: 'new desc' }, userId);
    expect(updated.name).toBe('new');
    expect(updated.description).toBe('new desc');
  });

  it('updateMtlsRole throws for non-existent role', async () => {
    await expect(updateMtlsRole(999, { name: 'x' }, 1)).rejects.toThrow();
  });

  it('updateMtlsRole can set description to null', async () => {
    const role = await createMtlsRole({ name: 'test', description: 'has desc' }, userId);
    const updated = await updateMtlsRole(role.id, { description: null }, userId);
    expect(updated.description).toBeNull();
  });

  it('deleteMtlsRole removes the role', async () => {
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await deleteMtlsRole(role.id, 1);
    const roles = await listMtlsRoles();
    expect(roles).toEqual([]);
  });

  it('deleteMtlsRole throws for non-existent role', async () => {
    await expect(deleteMtlsRole(999, 1)).rejects.toThrow();
  });
});

describe('mtls-roles certificate assignments', () => {
  it('assignRoleToCertificate creates assignment', async () => {
    const { cert1 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);

    const fetched = await getMtlsRole(role.id);
    expect(fetched!.certificateIds).toContain(cert1.id);
  });

  it('assignRoleToCertificate throws for non-existent role', async () => {
    const { cert1 } = await seedCaAndCerts();
    await expect(assignRoleToCertificate(999, cert1.id, 1)).rejects.toThrow();
  });

  it('assignRoleToCertificate throws for non-existent cert', async () => {
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await expect(assignRoleToCertificate(role.id, 999, 1)).rejects.toThrow();
  });

  it('assignRoleToCertificate throws on duplicate assignment', async () => {
    const { cert1 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await expect(assignRoleToCertificate(role.id, cert1.id, 1)).rejects.toThrow();
  });

  it('removeRoleFromCertificate removes assignment', async () => {
    const { cert1 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await removeRoleFromCertificate(role.id, cert1.id, 1);

    const fetched = await getMtlsRole(role.id);
    expect(fetched!.certificateIds).toEqual([]);
  });

  it('removeRoleFromCertificate throws for non-existent role', async () => {
    await expect(removeRoleFromCertificate(999, 1, 1)).rejects.toThrow();
  });

  it('getCertificateRoles returns roles for a cert', async () => {
    const { cert1 } = await seedCaAndCerts();
    const role1 = await createMtlsRole({ name: 'admin' }, userId);
    const role2 = await createMtlsRole({ name: 'viewer' }, userId);
    await assignRoleToCertificate(role1.id, cert1.id, 1);
    await assignRoleToCertificate(role2.id, cert1.id, 1);

    const roles = await getCertificateRoles(cert1.id);
    expect(roles).toHaveLength(2);
    expect(roles.map(r => r.name).sort()).toEqual(['admin', 'viewer']);
  });

  it('getCertificateRoles returns empty array for cert with no roles', async () => {
    const { cert1 } = await seedCaAndCerts();
    const roles = await getCertificateRoles(cert1.id);
    expect(roles).toEqual([]);
  });

  it('a cert can be in multiple roles', async () => {
    const { cert1 } = await seedCaAndCerts();
    const r1 = await createMtlsRole({ name: 'r1' }, userId);
    const r2 = await createMtlsRole({ name: 'r2' }, userId);
    const r3 = await createMtlsRole({ name: 'r3' }, userId);
    await assignRoleToCertificate(r1.id, cert1.id, 1);
    await assignRoleToCertificate(r2.id, cert1.id, 1);
    await assignRoleToCertificate(r3.id, cert1.id, 1);
    const roles = await getCertificateRoles(cert1.id);
    expect(roles).toHaveLength(3);
  });

  it('a role can have multiple certs', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await assignRoleToCertificate(role.id, cert2.id, 1);
    const fetched = await getMtlsRole(role.id);
    expect(fetched!.certificateIds).toHaveLength(2);
  });
});

describe('buildRoleFingerprintMap', () => {
  it('returns empty map when no roles exist', async () => {
    const map = await buildRoleFingerprintMap();
    expect(map.size).toBe(0);
  });

  it('maps role IDs to normalized fingerprints of active certs', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await assignRoleToCertificate(role.id, cert2.id, 1);

    const map = await buildRoleFingerprintMap();
    expect(map.has(role.id)).toBe(true);
    const fps = map.get(role.id)!;
    expect(fps.size).toBe(2);
    // Fingerprints are normalized: colons stripped, lowercased
    expect(fps.has('aabbccdd')).toBe(true);
    expect(fps.has('eeff0011')).toBe(true);
  });

  it('excludes revoked certs from fingerprint map', async () => {
    const { revokedCert } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, revokedCert.id, 1);

    const map = await buildRoleFingerprintMap();
    // Role exists but has no active certs
    expect(map.has(role.id)).toBe(false);
  });

  it('handles multiple roles with overlapping certs', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const r1 = await createMtlsRole({ name: 'r1' }, userId);
    const r2 = await createMtlsRole({ name: 'r2' }, userId);
    await assignRoleToCertificate(r1.id, cert1.id, 1);
    await assignRoleToCertificate(r2.id, cert1.id, 1);
    await assignRoleToCertificate(r2.id, cert2.id, 1);

    const map = await buildRoleFingerprintMap();
    expect(map.get(r1.id)!.size).toBe(1);
    expect(map.get(r2.id)!.size).toBe(2);
  });
});

describe('buildCertFingerprintMap', () => {
  it('returns empty map when no certs exist', async () => {
    const map = await buildCertFingerprintMap();
    expect(map.size).toBe(0);
  });

  it('maps cert IDs to normalized fingerprints', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const map = await buildCertFingerprintMap();
    expect(map.get(cert1.id)).toBe('aabbccdd');
    expect(map.get(cert2.id)).toBe('eeff0011');
  });

  it('excludes revoked certs', async () => {
    const { revokedCert } = await seedCaAndCerts();
    const map = await buildCertFingerprintMap();
    expect(map.has(revokedCert.id)).toBe(false);
  });
});

describe('buildRoleCertIdMap', () => {
  it('returns empty map when no roles exist', async () => {
    const map = await buildRoleCertIdMap();
    expect(map.size).toBe(0);
  });

  it('maps role IDs to cert IDs of active certs', async () => {
    const { cert1, cert2 } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, cert1.id, 1);
    await assignRoleToCertificate(role.id, cert2.id, 1);

    const map = await buildRoleCertIdMap();
    expect(map.has(role.id)).toBe(true);
    expect(map.get(role.id)!.has(cert1.id)).toBe(true);
    expect(map.get(role.id)!.has(cert2.id)).toBe(true);
  });

  it('excludes revoked certs from role cert ID map', async () => {
    const { revokedCert } = await seedCaAndCerts();
    const role = await createMtlsRole({ name: 'admin' }, userId);
    await assignRoleToCertificate(role.id, revokedCert.id, 1);

    const map = await buildRoleCertIdMap();
    expect(map.has(role.id)).toBe(false);
  });
});
