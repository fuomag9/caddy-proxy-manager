/**
 * Integration tests for issueClientCertificateAction in
 * app/(dashboard)/certificates/ca-actions.ts.
 *
 * Production Next.js replaces the message of an error thrown from a server
 * action with a generic one, so expected failures (such as a CA key that can
 * no longer be decrypted after a SESSION_SECRET change) must come back as a
 * returned `{ error }` the dialog can show.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { encryptUnderOtherSecret } from '../helpers/encrypt-under-other-secret';
import { caCertificates, issuedClientCertificates, users } from '../../src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

vi.mock('../../src/lib/db', async () => ({
  get default() { return db; },
  nowIso: () => new Date().toISOString(),
  toIso: (v: string | null) => v,
}));
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig: vi.fn() }));
vi.mock('../../src/lib/audit', () => ({ logAuditEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { requireAdminMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(async () => ({ user: { id: '1' } })),
}));
vi.mock('@/src/lib/auth', () => ({ requireAdmin: requireAdminMock }));

const { generateCaCertificateAction, issueClientCertificateAction } =
  await import('../../app/(dashboard)/certificates/ca-actions');
const { CA_PRIVATE_KEY_UNAVAILABLE_MESSAGE } = await import('../../src/lib/models/ca-certificates');

beforeEach(async () => {
  db = createTestDb();
  vi.clearAllMocks();
  const now = new Date().toISOString();
  const [user] = await db.insert(users).values({
    email: 'admin@test', name: 'Admin', role: 'admin',
    provider: 'credentials', subject: 'admin@test', status: 'active',
    createdAt: now, updatedAt: now,
  }).returning();
  requireAdminMock.mockResolvedValue({ user: { id: String(user.id) } });
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function generateCa() {
  const { id } = await generateCaCertificateAction(form({ name: 'Test CA', validity_days: '30' }));
  return id;
}

describe('issueClientCertificateAction', () => {
  const ISSUE_FIELDS = { common_name: 'alice', validity_days: '30', export_password: 'pw' };

  it('issues a PKCS#12 bundle signed by the stored CA key', async () => {
    const caId = await generateCa();

    const result = await issueClientCertificateAction(caId, form(ISSUE_FIELDS));

    expect(result).not.toHaveProperty('error');
    expect(result).toMatchObject({ passwordProtected: true, exportAlgorithm: 'aes256' });
    const issued = await db.select().from(issuedClientCertificates).where(eq(issuedClientCertificates.caCertificateId, caId));
    expect(issued.map((c) => c.commonName)).toEqual(['alice']);
  }, 30_000);

  it('returns an actionable error when the CA key cannot be decrypted', async () => {
    const caId = await generateCa();
    // Simulate a SESSION_SECRET change after the key was stored.
    await db.update(caCertificates)
      .set({ privateKeyPem: encryptUnderOtherSecret('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----') })
      .where(eq(caCertificates.id, caId));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await issueClientCertificateAction(caId, form(ISSUE_FIELDS));

    expect(result).toEqual({ error: CA_PRIVATE_KEY_UNAVAILABLE_MESSAGE });
    expect(await db.select().from(issuedClientCertificates)).toHaveLength(0);
    errorSpy.mockRestore();
  }, 30_000);

  it('returns input and lookup errors instead of throwing', async () => {
    expect(await issueClientCertificateAction(1, form({ ...ISSUE_FIELDS, common_name: ' ' })))
      .toEqual({ error: 'Common name is required' });
    expect(await issueClientCertificateAction(1, form({ ...ISSUE_FIELDS, export_password: '' })))
      .toEqual({ error: 'Export password is required' });
    expect(await issueClientCertificateAction(999, form(ISSUE_FIELDS)))
      .toEqual({ error: 'CA certificate not found' });

    const now = new Date().toISOString();
    const [keyless] = await db.insert(caCertificates).values({
      name: 'Imported CA', certificatePem: 'CERT', privateKeyPem: null, createdAt: now, updatedAt: now,
    }).returning();
    expect(await issueClientCertificateAction(keyless.id, form(ISSUE_FIELDS)))
      .toEqual({ error: expect.stringMatching(/no stored private key/) });
  });
});
