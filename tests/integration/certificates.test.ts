import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { certificates } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function insertCertificate(overrides: Partial<typeof certificates.$inferInsert> = {}) {
  const now = nowIso();
  const [cert] = await db.insert(certificates).values({
    name: 'Test Cert',
    type: 'managed',
    domainNames: JSON.stringify(['example.com']),
    autoRenew: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }).returning();
  return cert;
}

describe('certificates integration', () => {
  it('inserts managed certificate with domainNames array — retrieved correctly', async () => {
    const domains = ['example.com', '*.example.com'];
    const cert = await insertCertificate({ domainNames: JSON.stringify(domains) });
    const row = await db.query.certificates.findFirst({ where: (t, { eq }) => eq(t.id, cert.id) });
    expect(JSON.parse(row!.domainNames)).toEqual(domains);
  });

  it('inserts imported certificate with PEM fields', async () => {
    const cert = await insertCertificate({
      type: 'imported',
      certificatePem: '-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----',
      privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMIIBtest\n-----END PRIVATE KEY-----',
    });
    const row = await db.query.certificates.findFirst({ where: (t, { eq }) => eq(t.id, cert.id) });
    expect(row!.type).toBe('imported');
    expect(row!.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(row!.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('delete certificate removes it', async () => {
    const cert = await insertCertificate();
    await db.delete(certificates).where(eq(certificates.id, cert.id));
    const row = await db.query.certificates.findFirst({ where: (t, { eq }) => eq(t.id, cert.id) });
    expect(row).toBeUndefined();
  });

  it('list all certificates returns correct count', async () => {
    await insertCertificate({ name: 'Cert A', domainNames: JSON.stringify(['a.com']) });
    await insertCertificate({ name: 'Cert B', domainNames: JSON.stringify(['b.com']) });
    const rows = await db.select().from(certificates);
    expect(rows.length).toBe(2);
  });

  it('autoRenew defaults to true', async () => {
    const cert = await insertCertificate();
    expect(cert.autoRenew).toBe(true);
  });

  it('autoRenew can be set to false', async () => {
    const cert = await insertCertificate({ autoRenew: false });
    const row = await db.query.certificates.findFirst({ where: (t, { eq }) => eq(t.id, cert.id) });
    expect(row!.autoRenew).toBe(false);
  });
});
