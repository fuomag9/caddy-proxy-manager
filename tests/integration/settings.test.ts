import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';
import { settings } from '@/src/lib/db/schema';
import { eq } from 'drizzle-orm';

let db: TestDb;

beforeEach(() => {
  db = createTestDb();
});

function nowIso() {
  return new Date().toISOString();
}

async function setSetting(key: string, value: unknown) {
  const payload = JSON.stringify(value);
  const now = nowIso();
  await db.insert(settings).values({ key, value: payload, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: payload, updatedAt: now } });
}

async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: (t, { eq }) => eq(t.key, key) });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

describe('settings integration', () => {
  it('get non-existent key returns null', async () => {
    const value = await getSetting('nonexistent');
    expect(value).toBeNull();
  });

  it('set key — stored in db', async () => {
    await setSetting('test-key', 'test-value');
    const row = await db.query.settings.findFirst({ where: (t, { eq }) => eq(t.key, 'test-key') });
    expect(row).toBeDefined();
  });

  it('get key returns same value that was set', async () => {
    await setSetting('my-key', 'hello world');
    const value = await getSetting<string>('my-key');
    expect(value).toBe('hello world');
  });

  it('update existing key overwrites value', async () => {
    await setSetting('update-key', 'initial');
    await setSetting('update-key', 'updated');
    const value = await getSetting<string>('update-key');
    expect(value).toBe('updated');
  });

  it('stores object and retrieves it correctly', async () => {
    const obj = { enabled: true, resolvers: ['1.1.1.1', '8.8.8.8'], timeout: '5s' };
    await setSetting('dns', obj);
    const retrieved = await getSetting<typeof obj>('dns');
    expect(retrieved).toEqual(obj);
  });

  it('stores boolean true correctly', async () => {
    await setSetting('bool-key', true);
    const value = await getSetting<boolean>('bool-key');
    expect(value).toBe(true);
  });

  it('stores number correctly', async () => {
    await setSetting('num-key', 42);
    const value = await getSetting<number>('num-key');
    expect(value).toBe(42);
  });

  it('multiple keys are independent', async () => {
    await setSetting('key-a', 'value-a');
    await setSetting('key-b', 'value-b');
    expect(await getSetting<string>('key-a')).toBe('value-a');
    expect(await getSetting<string>('key-b')).toBe('value-b');
  });

  it('delete setting removes it', async () => {
    await setSetting('delete-me', 'value');
    await db.delete(settings).where(eq(settings.key, 'delete-me'));
    const value = await getSetting('delete-me');
    expect(value).toBeNull();
  });

  it('round-trips custom ACME settings under the "acme" key', async () => {
    const acme = {
      caUrl: 'https://ca.internal.example.com/acme/acme/directory',
      caRootPem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    };
    await setSetting('acme', acme);
    const stored = await getSetting<typeof acme>('acme');
    expect(stored).toEqual(acme);
  });
});
