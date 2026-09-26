/**
 * GET /api/instances/sync (the slave's sync public key) and the sync POST's
 * handling of sealed payloads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.INSTANCE_SYNC_RATE_MAX = '3';
});

vi.mock('@/src/lib/instance-sync', () => ({
  applySyncPayload: vi.fn(),
  getInstanceMode: vi.fn(),
  getSlaveMasterToken: vi.fn(),
  setSlaveLastSync: vi.fn(),
}));

import { GET, POST } from '@/app/api/instances/sync/route';
import { applyCaddyConfig } from '@/src/lib/caddy';
import { applySyncPayload, getInstanceMode, getSlaveMasterToken, setSlaveLastSync } from '@/src/lib/instance-sync';
import { SyncSealError, consumeSyncNonce, getSyncPublicKey } from '@/src/lib/sync-crypto';

const TOKEN = 'sync-token-0123456789abcdef0123456789abcdef';
const KEY_ID = '0123456789abcdef';
const NONCE = 'AbCdEfGhIjKlMnOpQrSt_-';
const SEALED = { secrets_sealed_key_id: KEY_ID, secrets_sealed_nonce: NONCE };

let clientNumber = 0;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getInstanceMode).mockResolvedValue('slave');
  vi.mocked(getSlaveMasterToken).mockResolvedValue(TOKEN);
  vi.mocked(applySyncPayload).mockResolvedValue(undefined);
  vi.mocked(setSlaveLastSync).mockResolvedValue(undefined);
});

/** A request from a client address of its own, unless `client` names one. */
function syncRequest(method: 'GET' | 'POST', options: { token?: string | null; body?: unknown; client?: string } = {}) {
  const headers: Record<string, string> = {
    'x-forwarded-for': options.client ?? `198.51.100.${++clientNumber}`,
  };
  if (options.token !== null) headers.authorization = `Bearer ${options.token ?? TOKEN}`;
  if (method === 'GET') return new NextRequest('http://localhost/api/instances/sync', { method, headers });
  headers['content-type'] = 'application/json';
  return new NextRequest('http://localhost/api/instances/sync', {
    method,
    headers,
    body: JSON.stringify(options.body ?? makePayload()),
  });
}

function makePayload(extra: Record<string, unknown> = {}) {
  return {
    generated_at: new Date().toISOString(),
    settings: {},
    data: {
      certificates: [],
      caCertificates: [],
      issuedClientCertificates: [],
      accessLists: [],
      accessListEntries: [],
      proxyHosts: [],
      l4ProxyHosts: [],
    },
    ...extra,
  };
}

describe('GET /api/instances/sync', () => {
  it("returns the slave's public key and a new single-use nonce, not to be cached", async () => {
    const response = await GET(syncRequest('GET'));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    const { publicKey, keyId } = getSyncPublicKey();
    expect(body).toEqual({
      version: 1,
      algorithm: 'x25519-hkdf-sha256-aes256gcm',
      publicKey: publicKey.toString('base64'),
      keyId,
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });

    const next = await (await GET(syncRequest('GET'))).json();
    expect(next.nonce).not.toBe(body.nonce);
    expect(consumeSyncNonce(body.nonce)).toBe(true);
    expect(consumeSyncNonce(body.nonce)).toBe(false);
  });

  it('issues no nonce to a refused request', async () => {
    const response = await GET(syncRequest('GET', { token: 'wrong-token-0123456789abcdef0123456789' }));

    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('nonce');
  });

  it.each([
    ['no token', { token: null }],
    ['a wrong token', { token: 'wrong-token-0123456789abcdef0123456789' }],
  ])('refuses a request with %s', async (_case, options) => {
    const response = await GET(syncRequest('GET', options));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('refuses every request when no sync token is configured', async () => {
    vi.mocked(getSlaveMasterToken).mockResolvedValue(null);

    expect((await GET(syncRequest('GET'))).status).toBe(401);
  });

  it.each(['master', 'standalone'] as const)('answers 403 on a %s instance', async (mode) => {
    vi.mocked(getInstanceMode).mockResolvedValue(mode);

    const response = await GET(syncRequest('GET'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Instance is not configured as a slave' });
  });

  it('is rate limited per client, separately from the sync requests', async () => {
    const client = '192.0.2.40';
    for (let i = 0; i < 3; i++) {
      expect((await GET(syncRequest('GET', { client, token: 'wrong-token-0123456789abcdef0123456789' }))).status).toBe(401);
    }
    const blocked = await GET(syncRequest('GET', { client }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    // The master's syncs from the same address are not held back by its key requests.
    expect((await POST(syncRequest('POST', { client }))).status).toBe(200);
  });
});

describe('POST /api/instances/sync with sealed secrets', () => {
  it('passes a sealed payload to applySyncPayload', async () => {
    const paths = [['dns_provider', 'providers', 'cloudflare', 'api_token']];
    const body = makePayload({ ...SEALED, settings_secret_paths: paths });

    const response = await POST(syncRequest('POST', { body }));

    expect(response.status).toBe(200);
    expect(applySyncPayload).toHaveBeenCalledWith(
      expect.objectContaining({ ...SEALED, settings_secret_paths: paths })
    );
  });

  it.each([
    ['a key id of another length', { ...SEALED, secrets_sealed_key_id: '0123' }],
    ['a key id with uppercase hex', { ...SEALED, secrets_sealed_key_id: '0123456789ABCDEF' }],
    ['a key id that is not a string', { ...SEALED, secrets_sealed_key_id: 123 }],
    ['a null key id', { ...SEALED, secrets_sealed_key_id: null }],
    ['no key id', { secrets_sealed_nonce: NONCE }],
    ['no nonce', { secrets_sealed_key_id: KEY_ID }],
    ['a short nonce', { ...SEALED, secrets_sealed_nonce: NONCE.slice(1) }],
    ['a nonce that is not base64url', { ...SEALED, secrets_sealed_nonce: `${NONCE.slice(1)}+` }],
    ['a nonce that is not a string', { ...SEALED, secrets_sealed_nonce: 42 }],
    ['secret paths that are not an array', { ...SEALED, settings_secret_paths: { general: [] } }],
    ['a secret path that is not an array', { ...SEALED, settings_secret_paths: ['general.token'] }],
    ['an empty secret path', { ...SEALED, settings_secret_paths: [[]] }],
    ['a secret path with an object part', { ...SEALED, settings_secret_paths: [['general', {}]] }],
  ])('rejects a sealed payload with %s', async (_case, extra) => {
    const response = await POST(syncRequest('POST', { body: makePayload(extra) }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid sync payload structure' });
    expect(applySyncPayload).not.toHaveBeenCalled();
  });

  it('keeps accepting malformed secret paths in unsealed payloads, as before', async () => {
    const response = await POST(syncRequest('POST', { body: makePayload({ settings_secret_paths: { general: [] } }) }));

    expect(response.status).toBe(200);
  });

  it.each([
    ['key_mismatch', 409, 'Sync payload was sealed for a different key; retry'],
    ['stale', 409, 'Sync payload was sealed for an expired or already used key request; retry'],
    ['open_failed', 400, 'Sealed secrets in the sync payload could not be opened'],
    ['malformed', 400, 'Sealed secrets in the sync payload could not be opened'],
  ] as const)('answers a %s failure with %i and a fixed message', async (code, status, message) => {
    vi.mocked(applySyncPayload).mockRejectedValueOnce(new SyncSealError(code));

    const response = await POST(syncRequest('POST', { body: makePayload(SEALED) }));

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
    expect(setSlaveLastSync).toHaveBeenCalledWith({ ok: false, error: message });
    expect(applyCaddyConfig).not.toHaveBeenCalled();
  });
});
