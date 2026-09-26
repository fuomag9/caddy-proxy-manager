/**
 * The master's store of pinned slave sync keys (src/lib/instance-sync-key-pins.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestDb } from '../helpers/db';

const ctx = vi.hoisted(() => ({ db: null as unknown as TestDb }));

vi.mock('../../src/lib/db', async () => {
  const { createTestDb } = await import('../helpers/db');
  const schemaModule = await import('../../src/lib/db/schema');
  ctx.db = createTestDb();
  return {
    default: ctx.db,
    schema: schemaModule,
    nowIso: () => new Date().toISOString(),
    toIso: (value: string | Date | null | undefined): string | null =>
      value ? new Date(value).toISOString() : null,
  };
});

import * as schema from '../../src/lib/db/schema';
import {
  SYNC_KEY_PINS_SETTING,
  deleteSyncKeyPin,
  getSyncKeyPin,
  isUnreadableSyncKeyPin,
  listSyncKeyPins,
  replaceSyncKeyPin,
  setSyncKeyPin,
  syncKeyPinIdentity,
  takeSyncKeyPin,
  updateSyncKeyPin,
} from '../../src/lib/instance-sync-key-pins';
import { syncKeyId } from '../../src/lib/sync-crypto';

const KEY_A = Buffer.alloc(32, 0x0a);
const KEY_B = Buffer.alloc(32, 0x0b);
const UNREADABLE = { keyId: '', publicKey: '', source: 'unreadable' };

async function storedRow() {
  return (await ctx.db.select().from(schema.settings).all()).find((row) => row.key === SYNC_KEY_PINS_SETTING);
}

beforeEach(async () => {
  await ctx.db.delete(schema.settings);
});

describe('syncKeyPinIdentity', () => {
  it.each([
    ['https://replica.example.com', 'https://replica.example.com'],
    ['https://replica.example.com/', 'https://replica.example.com'],
    [' HTTPS://Replica.Example.COM:443/ ', 'https://replica.example.com'],
    ['http://replica.example.com:80', 'http://replica.example.com'],
    ['https://replica.example.com:8443/', 'https://replica.example.com:8443'],
    ['https://replica.example.com/cpm/', 'https://replica.example.com/cpm'],
    ['https://replica.example.com/CPM', 'https://replica.example.com/CPM'],
    ['https://replica.example.com//', 'https://replica.example.com'],
    ['https://replica.example.com/cpm//', 'https://replica.example.com/cpm'],
    ['https://replica.example.com/cpm\\', 'https://replica.example.com/cpm'],
    ['https://replica.example.com/a/./b/../cpm/', 'https://replica.example.com/a/cpm'],
    ['https://replica.example.com/%2e%2e/cpm', 'https://replica.example.com/cpm'],
  ])('identifies %j as %j', (baseUrl, identity) => {
    expect(syncKeyPinIdentity(baseUrl)).toBe(identity);
  });

  it('identifies an identity as itself, so a listed pin URL finds its pin', () => {
    for (const baseUrl of [
      'https://replica.example.com//',
      'HTTPS://Replica.Example.com:443/cpm//',
      'https://replica.example.com/cpm\\',
      'http://[::1]:8080/a b/',
      'not a url//',
    ]) {
      const identity = syncKeyPinIdentity(baseUrl);
      expect(syncKeyPinIdentity(identity)).toBe(identity);
    }
  });

  it('tells apart URLs that reach different slaves', () => {
    const identities = [
      'https://replica.example.com',
      'http://replica.example.com',
      'https://replica.example.com:8443',
      'https://replica-2.example.com',
      'https://replica.example.com/cpm',
    ].map(syncKeyPinIdentity);
    expect(new Set(identities).size).toBe(identities.length);
  });
});

describe('sync key pin store', () => {
  it('sets, gets, lists and deletes pins by slave identity', async () => {
    expect(await listSyncKeyPins()).toEqual([]);
    expect(await getSyncKeyPin('https://replica.example.com')).toBeNull();

    const pinA = await setSyncKeyPin('https://replica.example.com/', { publicKey: KEY_A, source: 'first-use' });
    const pinB = await setSyncKeyPin('https://another.example.com', { publicKey: KEY_B.toString('base64'), source: 'rotation' });

    expect(pinA).toEqual({
      keyId: syncKeyId(KEY_A),
      publicKey: KEY_A.toString('base64'),
      pinnedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      source: 'first-use',
    });
    expect(pinB).toMatchObject({ keyId: syncKeyId(KEY_B), source: 'rotation' });
    expect(await getSyncKeyPin('HTTPS://replica.example.com:443')).toEqual(pinA);
    expect(await listSyncKeyPins()).toEqual([
      { identity: 'https://another.example.com', ...pinB },
      { identity: 'https://replica.example.com', ...pinA },
    ]);

    expect(await deleteSyncKeyPin('https://replica.example.com')).toBe(true);
    expect(await deleteSyncKeyPin('https://replica.example.com')).toBe(false);
    expect(await getSyncKeyPin('https://replica.example.com')).toBeNull();
    expect(await listSyncKeyPins()).toEqual([{ identity: 'https://another.example.com', ...pinB }]);

    // The row goes with the last pin.
    expect(await deleteSyncKeyPin('https://another.example.com')).toBe(true);
    expect(await storedRow()).toBeUndefined();
  });

  it('replaces a pin', async () => {
    await setSyncKeyPin('https://replica.example.com', { publicKey: KEY_A, source: 'first-use' });
    await setSyncKeyPin('https://replica.example.com', { publicKey: KEY_B, source: 'rotation' });

    expect(await listSyncKeyPins()).toEqual([
      expect.objectContaining({ identity: 'https://replica.example.com', keyId: syncKeyId(KEY_B), source: 'rotation' }),
    ]);
  });

  it('pins a key an admin sets, and reports the pin it replaced', async () => {
    expect(await replaceSyncKeyPin('https://replica.example.com', { publicKey: KEY_A, source: 'manual' }))
      .toEqual({ pin: expect.objectContaining({ keyId: syncKeyId(KEY_A), source: 'manual' }), replaced: null });

    const { pin, replaced } = await replaceSyncKeyPin('https://replica.example.com/', { publicKey: KEY_B, source: 'manual' });

    expect(replaced).toMatchObject({ keyId: syncKeyId(KEY_A), source: 'manual' });
    expect(await getSyncKeyPin('https://replica.example.com')).toEqual(pin);
  });

  it.each([
    ['a short key', { publicKey: Buffer.alloc(31, 1), source: 'first-use' }],
    ['a key that is not base64', { publicKey: `${'-'.repeat(43)}=`, source: 'first-use' }],
    ['a low-order key', { publicKey: Buffer.alloc(32), source: 'manual' }],
    ['an unknown source', { publicKey: KEY_A, source: 'imported' }],
    ['the source of unreadable pins', { publicKey: KEY_A, source: 'unreadable' }],
  ])('refuses %s without writing anything', async (_case, input) => {
    await expect(setSyncKeyPin('https://replica.example.com', input as never)).rejects.toThrow();
    expect(await storedRow()).toBeUndefined();
  });

  it('updates a pin only when asked, returning the result', () => {
    const seen: unknown[] = [];
    expect(updateSyncKeyPin('https://replica.example.com', (current) => {
      seen.push(current);
      return { result: 'pinned', pin: { publicKey: KEY_A, source: 'first-use' } };
    })).toBe('pinned');
    expect(updateSyncKeyPin('https://replica.example.com', (current) => {
      seen.push(current);
      return { result: 'kept' };
    })).toBe('kept');

    expect(seen).toEqual([null, expect.objectContaining({ keyId: syncKeyId(KEY_A), source: 'first-use' })]);
  });

  it('keeps a pin with a source this release does not know, which plays no part in checking a key', async () => {
    const good = await setSyncKeyPin('https://replica.example.com', { publicKey: KEY_A, source: 'first-use' });
    await ctx.db.update(schema.settings).set({
      value: JSON.stringify({ 'https://replica.example.com': { ...good, source: 'imported', addedBy: 'a newer release' } }),
    });

    expect(await getSyncKeyPin('https://replica.example.com')).toEqual({ ...good, source: 'imported' });
  });

  it('keeps stored entries that are not well-formed pins as unreadable pins, which match no key', async () => {
    const good = await setSyncKeyPin('https://replica.example.com', { publicKey: KEY_A, source: 'first-use' });
    const stored = JSON.parse((await storedRow())!.value);
    const malformed = {
      'https://wrong-id.example.com': { ...good, keyId: syncKeyId(KEY_B) },
      'https://short-key.example.com': { ...good, publicKey: Buffer.alloc(31, 1).toString('base64'), keyId: syncKeyId(Buffer.alloc(31, 1)) },
      'https://no-source.example.com': { ...good, source: undefined },
      'https://new-format.example.com': { version: 2, key: 'x', pinnedAt: good.pinnedAt },
      'https://not-an-object.example.com': 'pin',
    };
    const value = JSON.stringify({ ...stored, ...malformed });
    // An own "__proto__" key, as JSON can hold, stays an ordinary entry.
    await ctx.db.update(schema.settings).set({ value: value.replace(/^\{/, `{"__proto__":${JSON.stringify(good)},`) });

    expect(await listSyncKeyPins()).toEqual([
      { identity: '__proto__', ...good },
      { identity: 'https://new-format.example.com', ...UNREADABLE, pinnedAt: good.pinnedAt },
      { identity: 'https://no-source.example.com', ...UNREADABLE, pinnedAt: good.pinnedAt },
      { identity: 'https://not-an-object.example.com', ...UNREADABLE, pinnedAt: '' },
      { identity: 'https://replica.example.com', ...good },
      { identity: 'https://short-key.example.com', ...UNREADABLE, pinnedAt: good.pinnedAt },
      { identity: 'https://wrong-id.example.com', ...UNREADABLE, pinnedAt: good.pinnedAt },
    ]);
    const unreadable = (await getSyncKeyPin('https://wrong-id.example.com'))!;
    expect(isUnreadableSyncKeyPin(unreadable)).toBe(true);
    expect(isUnreadableSyncKeyPin(good)).toBe(false);
    expect(({} as Record<string, unknown>).keyId).toBeUndefined();

    // Writes for other slaves keep them as stored; deleting one removes it.
    await setSyncKeyPin('https://another.example.com', { publicKey: KEY_B, source: 'first-use' });
    expect(await deleteSyncKeyPin('https://not-an-object.example.com')).toBe(true);
    const { 'https://not-an-object.example.com': _deleted, ...kept } = malformed;
    expect(JSON.parse((await storedRow())!.value)).toMatchObject(JSON.parse(JSON.stringify(kept)));
    expect(JSON.parse((await storedRow())!.value)).not.toHaveProperty(['https://not-an-object.example.com']);

    await ctx.db.update(schema.settings).set({ value: 'not json' });
    expect(await listSyncKeyPins()).toEqual([]);
  });

  it('takes a pin away unless `keep` says the slave still uses it', async () => {
    const pin = await setSyncKeyPin('https://replica.example.com', { publicKey: KEY_A, source: 'first-use' });
    const asked: string[] = [];

    expect(await takeSyncKeyPin('https://replica.example.com/', (identity) => (asked.push(identity), true))).toBeNull();
    expect(await getSyncKeyPin('https://replica.example.com')).toEqual(pin);
    expect(await takeSyncKeyPin('https://replica.example.com/', (identity) => (asked.push(identity), false))).toEqual(pin);
    expect(await getSyncKeyPin('https://replica.example.com')).toBeNull();

    expect(asked).toEqual(['https://replica.example.com', 'https://replica.example.com']);
    // Nothing to take: `keep` is not asked.
    expect(await takeSyncKeyPin('https://replica.example.com', () => { throw new Error('not asked'); })).toBeNull();
  });
});
