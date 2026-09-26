/**
 * Managing the sync key pins a master holds for its slaves: the pins in the
 * instances API and model, pinning a key read from the slave and resetting
 * pins (REST and the Settings page), editing an instance without losing its
 * pin, and releasing an instance's pin when it is deleted or moved to
 * another URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
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
vi.mock('../../src/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/api-auth')>()),
  requireApiAdmin: vi.fn(),
}));
vi.mock('../../src/lib/auth', () => ({
  auth: vi.fn(),
  checkSameOrigin: vi.fn(() => null),
  requireAdmin: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../src/lib/caddy', () => ({ applyCaddyConfig: vi.fn() }));
vi.mock('../../src/lib/models/waf-events', () => ({ getWafRuleMessages: vi.fn() }));
vi.mock('../../src/lib/models/api-tokens', () => ({ validateToken: vi.fn() }));

import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { logAuditEvent } from '../../src/lib/audit';
import * as schema from '../../src/lib/db/schema';
import { ApiAuthError, requireApiAdmin } from '../../src/lib/api-auth';
import { auth, checkSameOrigin, requireAdmin } from '../../src/lib/auth';
import { validateToken } from '../../src/lib/models/api-tokens';
import { GET as listInstancesRoute } from '../../app/api/v1/instances/route';
import { DELETE as deleteInstanceRoute, PUT as updateInstanceRoute } from '../../app/api/v1/instances/[id]/route';
import {
  DELETE as resetInstancePinRoute,
  PUT as pinInstanceKeyRoute,
} from '../../app/api/v1/instances/[id]/sync-key-pin/route';
import {
  DELETE as resetPinRoute,
  GET as listPinsRoute,
  PUT as pinKeyRoute,
} from '../../app/api/v1/instances/sync-key-pins/route';
import { GET as ownSyncKeyRoute } from '../../app/api/v1/instances/sync-key/route';
import {
  deleteSlaveInstanceAction,
  pinSlaveSyncKeyAction,
  resetSlaveSyncKeyPinAction,
  updateSlaveInstanceAction,
} from '../../app/(dashboard)/settings/actions';
import SettingsPage from '../../app/(dashboard)/settings/page';
import SettingsClient, {
  EditSlaveInstanceForm,
  RemovePinnedSlaveConfirmation,
  SyncKeyPinDialogBody,
} from '../../app/(dashboard)/settings/SettingsClient';
import { Dialog } from '../../src/components/ui/dialog';
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
  withSyncKeyPins,
} from '../../src/lib/models/instances';
import { SYNC_KEY_PINS_SETTING, getSyncKeyPin, setSyncKeyPin } from '../../src/lib/instance-sync-key-pins';
import { syncInstances } from '../../src/lib/instance-sync';
import { toEnvSlaveInstanceView } from '../../src/lib/instance-sync-view';
import { SYNC_KEY_CHANGED_ERROR } from '../../src/lib/instance-sync-error';
import { SYNC_KEY_ALGORITHM, SYNC_KEY_VERSION, getSyncPublicKey, syncKeyId } from '../../src/lib/sync-crypto';
import { decryptSecret } from '../../src/lib/secret';
import { formatDateTimeUtc } from '../../src/lib/date-format';

const SLAVE_URL = 'https://replica.example.com';
const OTHER_URL = 'https://other.example.com';
const TOKEN = 'pin-management-token-0123456789abcdef0123456789';
const ADMIN_ID = 7;

/** A slave key pair; `raw` is the public key the slave presents. */
function slaveKey() {
  const { publicKey } = generateKeyPairSync('x25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { raw, keyId: syncKeyId(raw) };
}

/** Answer the master's requests as a slave that presents `key`. */
function connectToSlave(key: { raw: Buffer; keyId: string }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      return Response.json({
        version: SYNC_KEY_VERSION,
        algorithm: SYNC_KEY_ALGORITHM,
        publicKey: key.raw.toString('base64'),
        keyId: key.keyId,
        nonce: randomBytes(16).toString('base64url'),
      });
    }
    return Response.json({ ok: true });
  });
}

function request(method = 'GET', search = '', body: unknown = {}, headers: Record<string, string> = {}): any {
  return {
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    method,
    nextUrl: { pathname: '/api/v1/instances', searchParams: new URLSearchParams(search) },
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

const INVALID_JSON = new SyntaxError('Unexpected token');

function params(id: number | string) {
  return { params: Promise.resolve({ id: String(id) }) };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The audit events of removed pins (logAuditEvent is mocked in tests/setup.vitest.ts). */
async function unpinEvents() {
  return vi.mocked(logAuditEvent).mock.calls
    .map(([event]) => event)
    .filter((event) => event.action === 'instance_sync_key_unpinned');
}

async function pinEvents() {
  return vi.mocked(logAuditEvent).mock.calls
    .map(([event]) => event)
    .filter((event) => event.action === 'instance_sync_key_pinned');
}

const base64 = (key: { raw: Buffer }) => key.raw.toString('base64');

async function addInstance(name: string, baseUrl: string) {
  return createInstance({ name, baseUrl, apiToken: TOKEN });
}

beforeEach(async () => {
  await ctx.db.delete(schema.instances);
  await ctx.db.delete(schema.settings);
  vi.mocked(logAuditEvent).mockClear();
  delete process.env.INSTANCE_SLAVES;
  process.env.INSTANCE_MODE = 'master';
  vi.mocked(requireApiAdmin).mockReset().mockResolvedValue({ userId: ADMIN_ID, role: 'admin', authMethod: 'bearer' });
  vi.mocked(requireAdmin).mockReset().mockResolvedValue({ user: { id: String(ADMIN_ID), role: 'admin' } } as never);
  vi.mocked(revalidatePath).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.INSTANCE_SLAVES;
  delete process.env.INSTANCE_MODE;
});

describe('instances carry their sync key pin', () => {
  it('lists each instance with the pin of its base URL', async () => {
    const key = slaveKey();
    await addInstance('Replica', `${SLAVE_URL}/`);
    await addInstance('Other', OTHER_URL);
    const pin = await setSyncKeyPin('HTTPS://Replica.Example.com:443', { publicKey: key.raw, source: 'first-use' });

    const instances = await listInstances();
    expect(instances.map(({ name, syncKeyPin }) => ({ name, syncKeyPin }))).toEqual([
      { name: 'Other', syncKeyPin: null },
      { name: 'Replica', syncKeyPin: pin },
    ]);

    const response = await listInstancesRoute(request());
    expect(response.status).toBe(200);
    expect((await response.json()).find((instance: any) => instance.name === 'Replica').syncKeyPin).toEqual({
      keyId: key.keyId,
      publicKey: key.raw.toString('base64'),
      pinnedAt: pin.pinnedAt,
      source: 'first-use',
    });
  });

  it('returns the pin from create and update', async () => {
    const key = slaveKey();
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'rotation' });

    const created = await addInstance('Replica', SLAVE_URL);
    expect(created.syncKeyPin).toEqual(pin);
    expect((await updateInstance(created.id, { name: 'Renamed' })).syncKeyPin).toEqual(pin);
  });

  it('adds the pin of their URL to INSTANCE_SLAVES entries for the Settings page', async () => {
    const key = slaveKey();
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });
    const views = [
      toEnvSlaveInstanceView({ name: 'replica', url: `${SLAVE_URL}/`, token: TOKEN }),
      toEnvSlaveInstanceView({ name: 'explicit', url: OTHER_URL, token: TOKEN, syncKeyId: key.keyId }),
    ];

    expect(await withSyncKeyPins(views)).toEqual([
      { name: 'replica', url: `${SLAVE_URL}/`, syncKeyPin: pin },
      { name: 'explicit', url: OTHER_URL, syncKeyId: key.keyId, syncKeyPin: null },
    ]);
    // The token never reaches the view.
    expect(JSON.stringify(views)).not.toContain(TOKEN);
  });
});

describe('DELETE /api/v1/instances/{id}/sync-key-pin', () => {
  it('removes the pin and audits it as the calling admin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const response = await resetInstancePinRoute(request('DELETE'), params(instance.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({
        userId: ADMIN_ID,
        entityType: 'instance',
        entityId: instance.id,
        summary: `Reset sync key pin ${key.keyId} of slave "Replica"`,
        data: { identity: SLAVE_URL, keyId: key.keyId, source: 'first-use', reason: 'reset' },
      }),
    ]);
  });

  it('answers 404 for an unknown instance, or one without a pin', async () => {
    const instance = await addInstance('Replica', SLAVE_URL);

    for (const [id, error] of [
      [instance.id + 1, 'Instance not found'],
      ['not-a-number', 'Instance not found'],
      [instance.id, 'Sync key pin not found'],
    ] as const) {
      const response = await resetInstancePinRoute(request('DELETE'), params(id));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error });
    }
    expect(await unpinEvents()).toEqual([]);
  });

  it('keeps the pin when the caller is not an admin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });
    vi.mocked(requireApiAdmin).mockRejectedValue(new ApiAuthError('Administrator privileges required', 403));

    const response = await resetInstancePinRoute(request('DELETE'), params(instance.id));

    expect(response.status).toBe(403);
    expect(await getSyncKeyPin(SLAVE_URL)).not.toBeNull();
  });

  it('lets the next sync pin the key the slave presents', async () => {
    const pinned = slaveKey();
    const rekeyed = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: pinned.raw, source: 'first-use' });
    connectToSlave(rekeyed);

    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect((await listInstances())[0].lastSyncError).toBe(SYNC_KEY_CHANGED_ERROR);
    expect((await getSyncKeyPin(SLAVE_URL))?.keyId).toBe(pinned.keyId);

    expect((await resetInstancePinRoute(request('DELETE'), params(instance.id))).status).toBe(200);

    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await getSyncKeyPin(SLAVE_URL)).toMatchObject({ keyId: rekeyed.keyId, source: 'first-use' });
    expect((await listInstances())[0].lastSyncError).toBeNull();
  });
});

describe('/api/v1/instances/sync-key-pins', () => {
  it('lists every pin with the slaves that use its URL', async () => {
    const shared = slaveKey();
    const explicit = slaveKey();
    const orphan = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'env-replica', url: `${SLAVE_URL}/`, token: TOKEN },
      { name: 'env-explicit', url: SLAVE_URL, token: TOKEN, syncKeyId: explicit.keyId },
    ]);
    const instance = await addInstance('Replica', SLAVE_URL);
    const sharedPin = await setSyncKeyPin(SLAVE_URL, { publicKey: shared.raw, source: 'first-use' });
    const orphanPin = await setSyncKeyPin('https://gone.example.com', { publicKey: orphan.raw, source: 'rotation' });

    const response = await listPinsRoute(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { ...orphanPin, url: 'https://gone.example.com', slaves: [] },
      {
        ...sharedPin,
        url: SLAVE_URL,
        slaves: [
          { type: 'instance', id: instance.id, name: 'Replica' },
          { type: 'env', name: 'env-replica', syncKeyId: null, syncPublicKey: null },
          { type: 'env', name: 'env-explicit', syncKeyId: explicit.keyId, syncPublicKey: null },
        ],
      },
    ]);
  });

  it('resets the pin of a slave URL, however it is written', async () => {
    const key = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'env-replica', url: SLAVE_URL, token: TOKEN }]);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const response = await resetPinRoute(request('DELETE', `url=${encodeURIComponent('HTTPS://replica.example.com:443/')}`));

    expect(response.status).toBe(200);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({
        userId: ADMIN_ID,
        entityId: null,
        summary: `Reset sync key pin ${key.keyId} of ${SLAVE_URL}`,
        data: { identity: SLAVE_URL, keyId: key.keyId, source: 'first-use', reason: 'reset' },
      }),
    ]);

    const again = await resetPinRoute(request('DELETE', `url=${encodeURIComponent(SLAVE_URL)}`));
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: 'Sync key pin not found' });
  });
});

describe('an instance releases its pin', () => {
  it('when it is deleted', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    await deleteInstance(instance.id, ADMIN_ID);

    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({
        userId: ADMIN_ID,
        entityId: instance.id,
        summary: `Removed sync key pin ${key.keyId} of deleted slave "Replica"`,
        data: { identity: SLAVE_URL, keyId: key.keyId, source: 'first-use', reason: 'instance_deleted' },
      }),
    ]);
  });

  it('when it is deleted through the API', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    expect((await deleteInstanceRoute(request('DELETE'), params(instance.id))).status).toBe(200);

    expect(await listInstances()).toEqual([]);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect((await unpinEvents())[0]).toMatchObject({ userId: ADMIN_ID, data: { reason: 'instance_deleted' } });
  });

  it('when its base URL changes', async () => {
    const key = slaveKey();
    const otherKey = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });
    const otherPin = await setSyncKeyPin(OTHER_URL, { publicKey: otherKey.raw, source: 'first-use' });

    const updated = await updateInstance(instance.id, { baseUrl: OTHER_URL }, ADMIN_ID);

    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(updated.syncKeyPin).toEqual(otherPin);
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({
        userId: ADMIN_ID,
        entityId: instance.id,
        summary: `Removed sync key pin ${key.keyId} of slave "Replica" after its base URL changed`,
        data: { identity: SLAVE_URL, keyId: key.keyId, source: 'first-use', reason: 'base_url_changed' },
      }),
    ]);
  });

  it.each([
    ['its URL is only written differently', { baseUrl: 'HTTPS://Replica.example.com/' }],
    ['its name changes', { name: 'Renamed' }],
    ['it is disabled', { enabled: false }],
    ['its token changes', { apiToken: `${TOKEN}-new` }],
  ])('but not when %s', async (_case, input) => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    expect((await updateInstance(instance.id, input, ADMIN_ID)).syncKeyPin).toEqual(pin);
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await unpinEvents()).toEqual([]);
  });

  it('but not while another instance uses the URL', async () => {
    const key = slaveKey();
    // Base URLs are unique as written, but these all reach the same slave.
    const instance = await addInstance('Replica', SLAVE_URL);
    const moved = await addInstance('Moved', `${SLAVE_URL}/`);
    await addInstance('Same slave', 'HTTPS://REPLICA.EXAMPLE.COM:443');
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    await deleteInstance(instance.id, ADMIN_ID);
    await updateInstance(moved.id, { baseUrl: OTHER_URL }, ADMIN_ID);

    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await unpinEvents()).toEqual([]);
  });

  it('but not while an INSTANCE_SLAVES entry uses the URL', async () => {
    const key = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'env-replica', url: `${SLAVE_URL}/`, token: TOKEN }]);
    const instance = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    await deleteInstance(instance.id, ADMIN_ID);

    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
  });
});

describe('Settings page actions', () => {
  it('reset an instance pin as the signed-in admin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const result = await resetSlaveSyncKeyPinAction(null, form({ instanceId: String(instance.id) }));

    expect(result).toEqual({
      success: true,
      message: `Sync key pin ${key.keyId} reset. The next sync pins the key the slave presents; use Sync now, ` +
        "then check the new key id against the slave's.",
    });
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({ userId: ADMIN_ID, entityId: instance.id, data: expect.objectContaining({ reason: 'reset' }) }),
    ]);
  });

  it('reset the pin of an INSTANCE_SLAVES entry by its URL', async () => {
    const key = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'env-replica', url: SLAVE_URL, token: TOKEN }]);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const result = await resetSlaveSyncKeyPinAction(null, form({ slaveUrl: SLAVE_URL }));

    expect(result.success).toBe(true);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([expect.objectContaining({ userId: ADMIN_ID, entityId: null })]);
  });

  it.each([
    ['no slave', {}, 'Invalid slave'],
    ['a malformed instance id', { instanceId: 'abc' }, 'Invalid slave'],
    ['an unknown instance', { instanceId: '999' }, 'Instance not found'],
    ['a URL without a pin', { slaveUrl: OTHER_URL }, 'Sync key pin not found'],
  ])('report %s', async (_case, fields, message) => {
    const key = slaveKey();
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    expect(await resetSlaveSyncKeyPinAction(null, form(fields))).toEqual({ success: false, message });
    expect(await getSyncKeyPin(SLAVE_URL)).not.toBeNull();
    expect(await unpinEvents()).toEqual([]);
  });

  it('reset nothing outside master mode or without admin rights', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });
    const fields = form({ instanceId: String(instance.id) });

    process.env.INSTANCE_MODE = 'standalone';
    expect(await resetSlaveSyncKeyPinAction(null, fields)).toEqual({
      success: false,
      message: 'Instance mode must be set to master to manage slaves',
    });

    process.env.INSTANCE_MODE = 'master';
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Administrator privileges required'));
    expect(await resetSlaveSyncKeyPinAction(null, fields)).toEqual({
      success: false,
      message: 'Failed to reset sync key pin',
    });

    expect(await getSyncKeyPin(SLAVE_URL)).not.toBeNull();
    expect(await unpinEvents()).toEqual([]);
  });

  it('release the pin of a deleted instance as the signed-in admin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    await deleteSlaveInstanceAction(form({ instanceId: String(instance.id) }));

    expect(await listInstances()).toEqual([]);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({ userId: ADMIN_ID, data: expect.objectContaining({ reason: 'instance_deleted' }) }),
    ]);
  });
});

describe('Settings page', () => {
  type SettingsProps = Parameters<typeof SettingsClient>[0];

  async function renderSettings() {
    const element = (await SettingsPage()) as { props: SettingsProps };
    return { props: element.props, html: renderToStaticMarkup(createElement(SettingsClient, element.props)) };
  }

  it("shows each slave's pinned key with its key pin button, the key INSTANCE_SLAVES sets, and pins without a slave", async () => {
    const pinnedKey = slaveKey();
    const envKey = slaveKey();
    const explicitKey = slaveKey();
    const fullKey = slaveKey();
    const orphanKey = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([
      { name: 'env-replica', url: OTHER_URL, token: TOKEN },
      { name: 'env-explicit', url: 'https://explicit.example.com', token: TOKEN, syncKeyId: explicitKey.keyId },
      { name: 'env-full', url: 'https://full.example.com', token: TOKEN, syncPublicKey: base64(fullKey) },
      { name: 'env-new', url: 'https://new.example.com', token: TOKEN },
    ]);
    const pinned = await addInstance('Pinned', SLAVE_URL);
    const unpinned = await addInstance('Unpinned', 'https://unpinned.example.com');
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: pinnedKey.raw, source: 'first-use' });
    const envPin = await setSyncKeyPin(OTHER_URL, { publicKey: envKey.raw, source: 'rotation' });
    const orphanPin = await setSyncKeyPin('https://gone.example.com/', { publicKey: orphanKey.raw, source: 'manual' });

    const { props, html } = await renderSettings();

    expect(props.instanceSync.master).toEqual({
      instances: [
        expect.objectContaining({ id: pinned.id, syncKeyPin: pin }),
        expect.objectContaining({ id: unpinned.id, syncKeyPin: null }),
      ],
      envInstances: [
        { name: 'env-replica', url: OTHER_URL, syncKeyPin: envPin },
        { name: 'env-explicit', url: 'https://explicit.example.com', syncKeyId: explicitKey.keyId, syncKeyPin: null },
        {
          name: 'env-full',
          url: 'https://full.example.com',
          syncKeyId: fullKey.keyId,
          syncPublicKey: base64(fullKey),
          syncKeyPin: null,
        },
        { name: 'env-new', url: 'https://new.example.com', syncKeyPin: null },
      ],
      orphanSyncKeyPins: [
        {
          url: 'https://gone.example.com',
          keyId: orphanPin.keyId,
          publicKey: orphanPin.publicKey,
          pinnedAt: orphanPin.pinnedAt,
          source: 'manual',
        },
      ],
    });
    expect(JSON.stringify(props)).not.toContain(TOKEN);

    expect(html).toContain(`${pin.keyId}</span>, pinned ${formatDateTimeUtc(pin.pinnedAt)} UTC (first use)`);
    expect(html).toContain(`${envPin.keyId}</span>, pinned ${formatDateTimeUtc(envPin.pinnedAt)} UTC (rotated)`);
    expect(html).toContain(`${orphanPin.keyId}</span>, pinned ${formatDateTimeUtc(orphanPin.pinnedAt)} UTC (set by an admin)`);
    expect(html).toContain(`${explicitKey.keyId}</span> (set in INSTANCE_SLAVES)`);
    expect(html).toContain(`${fullKey.keyId}</span> (full key set in INSTANCE_SLAVES)`);
    expect(html.match(/Sync key not pinned yet: pinned on the next sealed sync, or pin the slave(’|&rsquo;|&#x27;)s key now/g))
      .toHaveLength(2);
    expect(html).toContain('Key pins without a slave');
    // Every slave whose pin the master keeps, pinned or not, and the pin without a slave.
    expect(html.match(/>Key pin</g)).toHaveLength(5);
    expect(html.match(/>Edit</g)).toHaveLength(2);
  });

  it('asks before removing an instance whose key is pinned, which removes the pin too', async () => {
    const key = slaveKey();
    await addInstance('Pinned', SLAVE_URL);
    await addInstance('Unpinned', OTHER_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const { html } = await renderSettings();

    // The pinned instance's Remove opens a confirmation; the other one submits.
    const removeButtons = html.match(/<button[^>]*>Remove<\/button>/g)!;
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons.filter((button) => button.includes('type="button"'))).toHaveLength(1);
    expect(removeButtons.filter((button) => button.includes('type="submit"'))).toHaveLength(1);
  });

  it('marks a stored pin this release cannot read', async () => {
    await addInstance('Replica', SLAVE_URL);
    await ctx.db.insert(schema.settings).values({
      key: SYNC_KEY_PINS_SETTING,
      value: JSON.stringify({ [SLAVE_URL]: { version: 2 } }),
      updatedAt: new Date().toISOString(),
    });

    const { props, html } = await renderSettings();

    expect(props.instanceSync.master?.instances[0].syncKeyPin).toMatchObject({ keyId: '', source: 'unreadable' });
    expect(html).toContain('The stored sync key pin cannot be read by this release');
  });

  it('shows a slave its own sync key id and public key', async () => {
    process.env.INSTANCE_MODE = 'slave';

    const { props, html } = await renderSettings();

    const own = getSyncPublicKey();
    expect(props.instanceSync.slave).toMatchObject({ syncKeyId: own.keyId, syncPublicKey: own.publicKey.toString('base64') });
    expect(html).toContain(`sync key id is <span class="font-mono">${own.keyId}</span>`);
    expect(html).toContain(`<span class="font-mono break-all">${own.publicKey.toString('base64')}</span>`);
  });
});

describe('Settings page dialogs', () => {
  const noop = () => {};

  /** Dialog contents as they render once opened. */
  function renderOpen(content: ReactElement) {
    return renderToStaticMarkup(createElement(Dialog, { open: true }, content));
  }

  it('offer pinning a key read from the slave, and warn what a reset leaves open', async () => {
    const key = slaveKey();
    const pin = { keyId: key.keyId, publicKey: base64(key), pinnedAt: '2026-01-01T00:00:00.000Z', source: 'first-use' };
    const html = renderOpen(createElement(SyncKeyPinDialogBody, {
      slaveName: 'Replica', slaveUrl: SLAVE_URL, pin, target: { instanceId: 3 }, onDone: noop, onClose: noop,
    }));

    expect(html).toContain('name="publicKey"');
    // The full pinned key, to compare with the slave's.
    expect(html).toContain(`Pinned public key: <span class="font-mono break-all">${base64(key)}</span>`);
    expect(html).toContain('>Pin key<');
    expect(html).toContain('>Reset key pin<');
    expect(html).toContain('<input type="hidden" name="instanceId" value="3"/>');
    // The legacy payload a 405 gets once nothing is pinned.
    expect(html).toMatch(/Until a key is\s+pinned again, anything answering there like a slave on v1\.12\.0 or earlier \(HTTP 405\) receives the\s+certificate private keys unsealed/);
    expect(html).toContain('pinning its new key above avoids');

    const unpinned = renderOpen(createElement(SyncKeyPinDialogBody, {
      slaveName: 'Replica', slaveUrl: SLAVE_URL, pin: null, target: { slaveUrl: SLAVE_URL }, onDone: noop, onClose: noop,
    }));
    expect(unpinned).toContain('>Pin key<');
    expect(unpinned).not.toContain('>Reset key pin<');
    expect(unpinned).toContain(`<input type="hidden" name="slaveUrl" value="${SLAVE_URL}"/>`);
  });

  it('explain what removing a pinned instance drops, and what editing keeps', async () => {
    const instance = {
      id: 3, name: 'Replica', baseUrl: SLAVE_URL, enabled: true, lastSyncAt: null, lastSyncError: null,
      syncKeyPin: {
        keyId: '0123456789abcdef', publicKey: base64(slaveKey()), pinnedAt: '2026-01-01T00:00:00.000Z', source: 'first-use',
      },
    };

    const remove = renderOpen(createElement(RemovePinnedSlaveConfirmation, { instance, onClose: noop }));
    expect(remove).toMatch(/This also removes the sync key pin of/);
    expect(remove).toMatch(/\(HTTP 405\) receives the\s+certificate private keys unsealed/);
    expect(remove).toContain('use Edit instead');

    const edit = renderOpen(createElement(EditSlaveInstanceForm, { instance, onDone: noop, onClose: noop }));
    expect(edit).toContain('A new token keeps the sync key pin');
    expect(edit).toContain(`value="${SLAVE_URL}"`);
    expect(edit).toContain('placeholder="Leave blank to keep the current token"');
  });
});

describe('PUT /api/v1/instances/{id}/sync-key-pin', () => {
  it('pins the key an admin read from the slave, and syncs to that key only', async () => {
    const first = slaveKey();
    const verified = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: first.raw, source: 'first-use' });

    const response = await pinInstanceKeyRoute(request('PUT', '', { publicKey: base64(verified) }), params(instance.id));

    expect(response.status).toBe(200);
    const pin = await response.json();
    expect(pin).toEqual({
      keyId: verified.keyId, publicKey: base64(verified), pinnedAt: expect.any(String), source: 'manual',
    });
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await pinEvents()).toEqual([
      expect.objectContaining({
        userId: ADMIN_ID,
        entityType: 'instance',
        entityId: instance.id,
        summary: `Pinned sync key ${verified.keyId} of slave "Replica", replacing sync key pin ${first.keyId}`,
        data: { identity: SLAVE_URL, keyId: verified.keyId, source: 'manual', previousKeyId: first.keyId },
      }),
    ]);

    connectToSlave(first);
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    vi.restoreAllMocks();
    connectToSlave(verified);
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
  });

  it.each<[string, unknown, string]>([
    ['no key', {}, 'publicKey must be'],
    ['a key that is not base64', { publicKey: `${'-'.repeat(43)}=` }, 'publicKey must be'],
    ['a key id instead of a key', { publicKey: '0123456789abcdef' }, 'publicKey must be'],
    ['a low-order key', { publicKey: Buffer.alloc(32).toString('base64') }, 'publicKey must be'],
    ['a body that is not JSON', INVALID_JSON, 'Invalid JSON payload'],
  ])('refuses %s with 400, pinning nothing', async (_case, body, error) => {
    const instance = await addInstance('Replica', SLAVE_URL);

    const response = await pinInstanceKeyRoute(request('PUT', '', body), params(instance.id));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(error);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await pinEvents()).toEqual([]);
  });

  it('answers 404 for an unknown instance', async () => {
    const response = await pinInstanceKeyRoute(request('PUT', '', { publicKey: base64(slaveKey()) }), params(999));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Instance not found' });
  });
});

describe('PUT /api/v1/instances/sync-key-pins', () => {
  it('pins a key for an INSTANCE_SLAVES entry before its first sync', async () => {
    const key = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'env-replica', url: SLAVE_URL, token: TOKEN }]);

    const response = await pinKeyRoute(request('PUT', `url=${encodeURIComponent(`${SLAVE_URL}/`)}`, { publicKey: base64(key) }));

    expect(response.status).toBe(200);
    expect(await getSyncKeyPin(SLAVE_URL)).toMatchObject({ keyId: key.keyId, source: 'manual' });
    expect(await pinEvents()).toEqual([
      expect.objectContaining({ userId: ADMIN_ID, entityId: null, summary: `Pinned sync key ${key.keyId} of ${SLAVE_URL}` }),
    ]);
    // The entry is not pinned on first use to another key.
    connectToSlave(slaveKey());
    expect(await syncInstances()).toMatchObject({ success: 0, failed: 1 });
    expect(await getSyncKeyPin(SLAVE_URL)).toMatchObject({ keyId: key.keyId });
  });

  it.each<[string, string, unknown, string]>([
    ['no url', '', { publicKey: 'x' }, 'The url query parameter is required'],
    ['a url a slave cannot have', `url=${encodeURIComponent('https://replica.example.com/?x=1')}`, {},
      'Base URL must not contain a query string or fragment'],
    ['an invalid key', `url=${encodeURIComponent(SLAVE_URL)}`, { publicKey: 'x' }, 'publicKey must be'],
  ])('refuses %s with 400', async (_case, search, body, error) => {
    const response = await pinKeyRoute(request('PUT', search, body));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(error);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
  });

  it('resets a pin by the url the listing shows, however the slave URL was written', async () => {
    const key = slaveKey();
    await addInstance('Replica', 'https://x.example.com//');
    connectToSlave(key);
    expect(await syncInstances()).toMatchObject({ success: 1, failed: 0 });

    const [listed] = await (await listPinsRoute(request())).json();
    expect(listed).toMatchObject({ url: 'https://x.example.com', keyId: key.keyId });

    const response = await resetPinRoute(request('DELETE', `url=${encodeURIComponent(listed.url)}`));

    expect(response.status).toBe(200);
    expect(await getSyncKeyPin('https://x.example.com//')).toBeNull();
  });
});

describe('PUT /api/v1/instances/{id}', () => {
  it('changes the token and name and keeps the key pin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const response = await updateInstanceRoute(
      request('PUT', '', { name: 'Renamed', apiToken: `${TOKEN}-rotated` }),
      params(instance.id)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: instance.id, name: 'Renamed', baseUrl: SLAVE_URL, syncKeyPin: pin });
    expect(decryptSecret((await getInstance(instance.id))!.apiToken)).toBe(`${TOKEN}-rotated`);
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await unpinEvents()).toEqual([]);
  });

  it('releases the pin of the old URL when the base URL changes, as the calling admin', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    const response = await updateInstanceRoute(request('PUT', '', { baseUrl: OTHER_URL }), params(instance.id));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ baseUrl: OTHER_URL, syncKeyPin: null });
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({ userId: ADMIN_ID, data: expect.objectContaining({ reason: 'base_url_changed' }) }),
    ]);
  });

  it.each<[string, unknown, number, string]>([
    ['a weak token', { apiToken: 'short' }, 400, 'Sync token must be at least 32 characters'],
    ['an empty name', { name: ' ' }, 400, 'Instance name is required'],
    ['an enabled flag that is not a boolean', { enabled: 'yes' }, 400, 'enabled must be a boolean'],
    ['a base URL with a query string', { baseUrl: `${SLAVE_URL}/?x=1` }, 400, 'Base URL must not contain a query string or fragment'],
    ['a body that is not JSON', INVALID_JSON, 400, 'Invalid JSON payload'],
    ['a body that is not an object', ['Renamed'], 400, 'Request body must be an object'],
  ])('refuses %s, changing nothing', async (_case, body, status, error) => {
    const instance = await addInstance('Replica', SLAVE_URL);

    const response = await updateInstanceRoute(request('PUT', '', body), params(instance.id));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(await getInstance(instance.id)).toMatchObject({ name: 'Replica', baseUrl: SLAVE_URL, enabled: true });
  });

  it('answers 404 for an unknown instance', async () => {
    const response = await updateInstanceRoute(request('PUT', '', { name: 'x' }), params(999));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Instance not found' });
  });
});

describe('Settings page actions for editing and pinning', () => {
  it('edit an instance, keeping its token when the field is left blank', async () => {
    const key = slaveKey();
    const instance = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: key.raw, source: 'first-use' });

    expect(await updateSlaveInstanceAction(null, form({
      instanceId: String(instance.id), name: 'Renamed', baseUrl: `${SLAVE_URL}/`, apiToken: '',
    }))).toEqual({ success: true, message: 'Slave instance "Renamed" updated' });

    expect(await getInstance(instance.id)).toMatchObject({ name: 'Renamed', baseUrl: SLAVE_URL });
    expect(decryptSecret((await getInstance(instance.id))!.apiToken)).toBe(TOKEN);
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(revalidatePath).toHaveBeenCalledWith('/settings');

    // A new token; a new URL releases the pin, audited as the signed-in admin.
    expect((await updateSlaveInstanceAction(null, form({
      instanceId: String(instance.id), name: 'Renamed', baseUrl: OTHER_URL, apiToken: `${TOKEN}-rotated`,
    }))).success).toBe(true);
    expect(decryptSecret((await getInstance(instance.id))!.apiToken)).toBe(`${TOKEN}-rotated`);
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([expect.objectContaining({ userId: ADMIN_ID })]);
  });

  it.each<[string, Record<string, string>, string]>([
    ['no instance', { name: 'x', baseUrl: SLAVE_URL }, 'Invalid slave'],
    ['no name', { instanceId: 'ID', name: '', baseUrl: SLAVE_URL }, 'Name and base URL are required'],
    ['a weak token', { instanceId: 'ID', name: 'x', baseUrl: SLAVE_URL, apiToken: 'short' },
      'Sync token must be at least 32 characters. Consider using a randomly generated 32-byte token.'],
    ['a base URL a slave cannot have', { instanceId: 'ID', name: 'x', baseUrl: 'ftp://replica.example.com' },
      'Base URL must use https (or http with INSTANCE_SYNC_ALLOW_HTTP=true)'],
    ['an unknown instance', { instanceId: '999', name: 'x', baseUrl: SLAVE_URL }, 'Instance not found'],
  ])('refuse to edit with %s', async (_case, fields, message) => {
    const instance = await addInstance('Replica', SLAVE_URL);
    const withId = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === 'ID' ? String(instance.id) : v]));

    expect(await updateSlaveInstanceAction(null, form(withId))).toEqual({ success: false, message });
    expect(await getInstance(instance.id)).toMatchObject({ name: 'Replica', baseUrl: SLAVE_URL });
  });

  it('pin a key for an instance, or for an INSTANCE_SLAVES entry by its URL', async () => {
    const key = slaveKey();
    const envKey = slaveKey();
    process.env.INSTANCE_SLAVES = JSON.stringify([{ name: 'env-replica', url: OTHER_URL, token: TOKEN }]);
    const instance = await addInstance('Replica', SLAVE_URL);

    expect(await pinSlaveSyncKeyAction(null, form({ instanceId: String(instance.id), publicKey: ` ${base64(key)} ` })))
      .toEqual({ success: true, message: `Sync key ${key.keyId} pinned. Syncs are sealed to this key only.` });
    expect((await pinSlaveSyncKeyAction(null, form({ slaveUrl: OTHER_URL, publicKey: base64(envKey) }))).success).toBe(true);

    expect(await getSyncKeyPin(SLAVE_URL)).toMatchObject({ keyId: key.keyId, source: 'manual' });
    expect(await getSyncKeyPin(OTHER_URL)).toMatchObject({ keyId: envKey.keyId, source: 'manual' });
    expect(await pinEvents()).toEqual([
      expect.objectContaining({ userId: ADMIN_ID, entityId: instance.id }),
      expect.objectContaining({ userId: ADMIN_ID, entityId: null }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/settings');
  });

  it('refuse to pin an unusable key, outside master mode, or without admin rights', async () => {
    const instance = await addInstance('Replica', SLAVE_URL);
    const fields = form({ instanceId: String(instance.id), publicKey: base64(slaveKey()) });

    expect((await pinSlaveSyncKeyAction(null, form({ instanceId: String(instance.id), publicKey: 'not a key' }))).message)
      .toContain('publicKey must be');
    process.env.INSTANCE_MODE = 'standalone';
    expect(await pinSlaveSyncKeyAction(null, fields)).toEqual({
      success: false,
      message: 'Instance mode must be set to master to manage slaves',
    });
    expect(await updateSlaveInstanceAction(null, form({ instanceId: String(instance.id), name: 'x', baseUrl: OTHER_URL })))
      .toEqual({ success: false, message: 'Instance mode must be set to master to manage slaves' });
    process.env.INSTANCE_MODE = 'master';
    vi.mocked(requireAdmin).mockRejectedValue(new Error('Administrator privileges required'));
    expect(await pinSlaveSyncKeyAction(null, fields)).toEqual({ success: false, message: 'Failed to pin sync key' });
    expect(await updateSlaveInstanceAction(null, form({ instanceId: String(instance.id), name: 'x', baseUrl: OTHER_URL })))
      .toEqual({ success: false, message: 'Failed to update slave instance' });

    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await getInstance(instance.id)).toMatchObject({ name: 'Replica', baseUrl: SLAVE_URL });
    expect(await pinEvents()).toEqual([]);
  });

  it('reset an unreadable pin', async () => {
    const instance = await addInstance('Replica', SLAVE_URL);
    await ctx.db.insert(schema.settings).values({
      key: SYNC_KEY_PINS_SETTING, value: JSON.stringify({ [SLAVE_URL]: { version: 2 } }), updatedAt: new Date().toISOString(),
    });

    const result = await resetSlaveSyncKeyPinAction(null, form({ instanceId: String(instance.id) }));

    expect(result).toMatchObject({ success: true, message: expect.stringMatching(/^Unreadable sync key pin reset\./) });
    expect(await getSyncKeyPin(SLAVE_URL)).toBeNull();
    expect(await unpinEvents()).toEqual([
      expect.objectContaining({
        summary: 'Reset unreadable sync key pin of slave "Replica"',
        data: { identity: SLAVE_URL, keyId: null, source: 'unreadable', reason: 'reset' },
      }),
    ]);
  });
});

describe('the sync key pin endpoints authenticate like every admin endpoint', () => {
  const USER_TOKEN = 'user-api-token';

  type Call = [string, (req: any, id: number) => Promise<Response>, string, unknown];
  const calls: Call[] = [
    ['PUT /instances/{id}', (req, id) => updateInstanceRoute(req, params(id)), 'PUT', { name: 'x' }],
    ['PUT /instances/{id}/sync-key-pin', (req, id) => pinInstanceKeyRoute(req, params(id)), 'PUT', {}],
    ['DELETE /instances/{id}/sync-key-pin', (req, id) => resetInstancePinRoute(req, params(id)), 'DELETE', {}],
    ['GET /instances/sync-key-pins', (req) => listPinsRoute(req), 'GET', {}],
    ['PUT /instances/sync-key-pins', (req) => pinKeyRoute(req), 'PUT', {}],
    ['DELETE /instances/sync-key-pins', (req) => resetPinRoute(req), 'DELETE', {}],
    ['GET /instances/sync-key', (req) => ownSyncKeyRoute(req), 'GET', {}],
  ];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/api-auth')>('../../src/lib/api-auth');
    vi.mocked(requireApiAdmin).mockImplementation(actual.requireApiAdmin);
    vi.mocked(validateToken).mockReset();
    vi.mocked(auth).mockReset();
    vi.mocked(checkSameOrigin).mockReset().mockReturnValue(null);
  });

  async function callWith(call: Call, instanceId: number, headers: Record<string, string>) {
    const [, handler, method, body] = call;
    return (await handler(request(method, `url=${encodeURIComponent(SLAVE_URL)}`, body, headers), instanceId)).status;
  }

  it.each(calls)('%s: 401 without credentials, 403 for user and viewer tokens', async (...call) => {
    const { id } = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: slaveKey().raw, source: 'first-use' });

    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await callWith(call, id, {})).toBe(401);
    for (const role of ['user', 'viewer']) {
      vi.mocked(validateToken).mockResolvedValue({ token: {}, user: { id: 2, role } } as never);
      expect(await callWith(call, id, { authorization: `Bearer ${USER_TOKEN}` })).toBe(403);
    }
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await getInstance(id)).toMatchObject({ name: 'Replica' });
    vi.mocked(validateToken).mockResolvedValue({ token: {}, user: { id: ADMIN_ID, role: 'admin' } } as never);
    expect([401, 403]).not.toContain(await callWith(call, id, { authorization: `Bearer ${USER_TOKEN}` }));

    // Only the admin's call got through.
    expect(await unpinEvents()).toEqual(call[2] === 'DELETE' ? [expect.objectContaining({ userId: ADMIN_ID })] : []);
  });

  it.each(calls.filter((call) => call[2] !== 'GET'))('%s: 403 for a cross-origin session request', async (...call) => {
    const { id } = await addInstance('Replica', SLAVE_URL);
    const pin = await setSyncKeyPin(SLAVE_URL, { publicKey: slaveKey().raw, source: 'first-use' });
    vi.mocked(auth).mockResolvedValue({ user: { id: String(ADMIN_ID), role: 'admin' } } as never);
    vi.mocked(checkSameOrigin).mockReturnValue(Response.json({ error: 'Forbidden' }, { status: 403 }) as never);

    expect(await callWith(call, id, { origin: 'https://elsewhere.example.com' })).toBe(403);
    expect(await getSyncKeyPin(SLAVE_URL)).toEqual(pin);
    expect(await getInstance(id)).toMatchObject({ name: 'Replica' });
  });
});
