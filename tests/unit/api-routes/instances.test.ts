import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/instances', () => ({
  listInstances: vi.fn(),
  createInstance: vi.fn(),
  deleteInstance: vi.fn(),
  updateInstance: vi.fn(),
  resetInstanceSyncKeyPin: vi.fn(),
  resetSyncKeyPin: vi.fn(),
  pinInstanceSyncKey: vi.fn(),
  pinSyncKey: vi.fn(),
  listSyncKeyPinsWithSlaves: vi.fn(),
}));

vi.mock('@/src/lib/instance-sync', () => ({
  syncInstances: vi.fn(),
}));

vi.mock('@/src/lib/api-auth', () => {
  const ApiAuthError = class extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; this.name = 'ApiAuthError'; }
  };
  return {
    requireApiAdmin: vi.fn().mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' }),
    requireApiUser: vi.fn().mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' }),
    apiErrorResponse: vi.fn((error: unknown) => {
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
    }),
    ApiAuthError,
  };
});

import { GET, POST } from '@/app/api/v1/instances/route';
import { DELETE, PUT } from '@/app/api/v1/instances/[id]/route';
import { DELETE as resetPinDELETE, PUT as pinPUT } from '@/app/api/v1/instances/[id]/sync-key-pin/route';
import { GET as pinsGET, DELETE as pinsDELETE, PUT as pinsPUT } from '@/app/api/v1/instances/sync-key-pins/route';
import { GET as syncKeyGET } from '@/app/api/v1/instances/sync-key/route';
import { POST as syncPOST } from '@/app/api/v1/instances/sync/route';
import {
  listInstances,
  createInstance,
  deleteInstance,
  listSyncKeyPinsWithSlaves,
  pinInstanceSyncKey,
  pinSyncKey,
  resetInstanceSyncKeyPin,
  resetSyncKeyPin,
  updateInstance,
} from '@/src/lib/models/instances';
import { getSyncPublicKey } from '@/src/lib/sync-crypto';
import { syncInstances } from '@/src/lib/instance-sync';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listInstances);
const mockCreate = vi.mocked(createInstance);
const mockDelete = vi.mocked(deleteInstance);
const mockSync = vi.mocked(syncInstances);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);
const mockResetInstancePin = vi.mocked(resetInstanceSyncKeyPin);
const mockResetPin = vi.mocked(resetSyncKeyPin);
const mockListPins = vi.mocked(listSyncKeyPinsWithSlaves);
const mockUpdate = vi.mocked(updateInstance);
const mockPinInstance = vi.mocked(pinInstanceSyncKey);
const mockPin = vi.mocked(pinSyncKey);

function createMockRequest(options: { method?: string; body?: unknown; search?: string } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/instances', searchParams: new URLSearchParams(options.search ?? '') },
    json: async () => options.body ?? {},
  };
}

const samplePin = {
  keyId: '0123456789abcdef',
  publicKey: Buffer.alloc(32, 1).toString('base64'),
  pinnedAt: '2026-01-01T00:00:00.000Z',
  source: 'first-use' as const,
};

const sampleInstance = {
  id: 1,
  name: 'Slave 1',
  url: 'https://slave1.example.com:3000',
  token: 'sync-token-abc',
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/instances', () => {
  it('returns list of instances', async () => {
    mockList.mockResolvedValue([sampleInstance] as any);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleInstance]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await GET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/instances', () => {
  it('creates an instance and returns 201', async () => {
    const body = {
      name: 'Slave 2',
      baseUrl: 'https://slave2.example.com:3000',
      apiToken: 'a'.repeat(32),
    };
    mockCreate.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body);
  });

  it('rejects a weak sync token before creating an instance', async () => {
    const body = {
      name: 'Weak slave',
      baseUrl: 'https://weak.example.com:3000',
      apiToken: 'short',
    };

    const response = await POST(createMockRequest({ method: 'POST', body }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Sync token must be at least 32 characters' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/instances/[id]', () => {
  it('deletes an instance', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '3' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    // The caller is passed on for the audit event of the pin it releases.
    expect(mockDelete).toHaveBeenCalledWith(3, 1);
  });
});

describe('PUT /api/v1/instances/[id]', () => {
  it('passes the known fields and the calling admin to updateInstance', async () => {
    mockUpdate.mockResolvedValue({ id: 3, name: 'Renamed' } as any);
    const body = { name: 'Renamed', baseUrl: 'https://slave.example.com', apiToken: 'b'.repeat(32), enabled: false, id: 9 };

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 3, name: 'Renamed' });
    expect(mockUpdate).toHaveBeenCalledWith(
      3,
      { name: 'Renamed', baseUrl: 'https://slave.example.com', apiToken: 'b'.repeat(32), enabled: false },
      1
    );
  });

  it('rejects a weak sync token before updating', async () => {
    const response = await PUT(createMockRequest({ method: 'PUT', body: { apiToken: 'short' } }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Sync token must be at least 32 characters' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('updates nothing without admin rights', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Administrator privileges required', 403));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { name: 'x' } }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/instances/[id]/sync-key-pin', () => {
  it('pins the key in the body as the calling admin', async () => {
    mockPinInstance.mockResolvedValue({ ...samplePin, source: 'manual' });

    const response = await pinPUT(
      createMockRequest({ method: 'PUT', body: { publicKey: samplePin.publicKey } }),
      { params: Promise.resolve({ id: '3' }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...samplePin, source: 'manual' });
    expect(mockPinInstance).toHaveBeenCalledWith(3, samplePin.publicKey, 1);
  });

  it('pins nothing without admin rights', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Administrator privileges required', 403));

    const response = await pinPUT(createMockRequest({ method: 'PUT', body: { publicKey: samplePin.publicKey } }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(403);
    expect(mockPinInstance).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/instances/[id]/sync-key-pin', () => {
  it('resets the instance pin as the calling admin', async () => {
    mockResetInstancePin.mockResolvedValue(samplePin);

    const response = await resetPinDELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockResetInstancePin).toHaveBeenCalledWith(3, 1);
  });

  it('resets nothing without admin rights', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Administrator privileges required', 403));

    const response = await resetPinDELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '3' }) });

    expect(response.status).toBe(403);
    expect(mockResetInstancePin).not.toHaveBeenCalled();
  });
});

describe('/api/v1/instances/sync-key-pins', () => {
  it('lists the pins', async () => {
    const listing = [{ ...samplePin, url: 'https://replica.example.com', slaves: [] }];
    mockListPins.mockResolvedValue(listing);

    const response = await pinsGET(createMockRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(listing);
  });

  it('resets the pin of the url in the query as the calling admin', async () => {
    mockResetPin.mockResolvedValue(samplePin);

    const response = await pinsDELETE(createMockRequest({
      method: 'DELETE',
      search: `url=${encodeURIComponent(' https://replica.example.com/ ')}`,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockResetPin).toHaveBeenCalledWith('https://replica.example.com/', 1);
  });

  it.each(['', 'url=', 'url=%20'])('rejects a request without a url (%j)', async (search) => {
    const response = await pinsDELETE(createMockRequest({ method: 'DELETE', search }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'The url query parameter is required' });
    expect(mockResetPin).not.toHaveBeenCalled();

    const put = await pinsPUT(createMockRequest({ method: 'PUT', search, body: { publicKey: samplePin.publicKey } }));
    expect(put.status).toBe(400);
    expect(mockPin).not.toHaveBeenCalled();
  });

  it('pins the key in the body for the url in the query as the calling admin', async () => {
    mockPin.mockResolvedValue({ ...samplePin, source: 'manual' });

    const response = await pinsPUT(createMockRequest({
      method: 'PUT',
      search: `url=${encodeURIComponent(' https://replica.example.com/ ')}`,
      body: { publicKey: samplePin.publicKey },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...samplePin, source: 'manual' });
    expect(mockPin).toHaveBeenCalledWith('https://replica.example.com/', samplePin.publicKey, 1);
  });

  it.each([
    ['GET', () => pinsGET(createMockRequest())],
    ['PUT', () => pinsPUT(createMockRequest({ method: 'PUT', search: 'url=https://replica.example.com', body: {} }))],
    ['DELETE', () => pinsDELETE(createMockRequest({ method: 'DELETE', search: 'url=https://replica.example.com' }))],
  ])('%s requires admin rights', async (_method, call) => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await call();

    expect(response.status).toBe(401);
    expect(mockListPins).not.toHaveBeenCalled();
    expect(mockResetPin).not.toHaveBeenCalled();
    expect(mockPin).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/instances/sync-key', () => {
  it("returns this instance's own sync key", async () => {
    const { keyId, publicKey } = getSyncPublicKey();

    const response = await syncKeyGET(createMockRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ keyId, publicKey: publicKey.toString('base64') });
  });

  it('requires admin rights', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await syncKeyGET(createMockRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('POST /api/v1/instances/sync', () => {
  it('syncs instances and returns result', async () => {
    const syncResult = { synced: 2, errors: [] };
    mockSync.mockResolvedValue(syncResult as any);

    const response = await syncPOST(createMockRequest({ method: 'POST' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(syncResult);
    expect(mockSync).toHaveBeenCalled();
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await syncPOST(createMockRequest({ method: 'POST' }));
    expect(response.status).toBe(401);
  });
});
