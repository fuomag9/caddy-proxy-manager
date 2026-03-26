import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/instances', () => ({
  listInstances: vi.fn(),
  createInstance: vi.fn(),
  deleteInstance: vi.fn(),
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
      const { NextResponse } = require('next/server');
      if (error && typeof error === 'object' && 'status' in error) {
        return NextResponse.json({ error: (error as Error).message }, { status: (error as any).status });
      }
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
    }),
    ApiAuthError,
  };
});

import { GET, POST } from '@/app/api/v1/instances/route';
import { DELETE } from '@/app/api/v1/instances/[id]/route';
import { POST as syncPOST } from '@/app/api/v1/instances/sync/route';
import { listInstances, createInstance, deleteInstance } from '@/src/lib/models/instances';
import { syncInstances } from '@/src/lib/instance-sync';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listInstances);
const mockCreate = vi.mocked(createInstance);
const mockDelete = vi.mocked(deleteInstance);
const mockSync = vi.mocked(syncInstances);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/instances', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

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
    const body = { name: 'Slave 2', url: 'https://slave2.example.com:3000', token: 'token-xyz' };
    mockCreate.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body);
  });
});

describe('DELETE /api/v1/instances/[id]', () => {
  it('deletes an instance', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(1);
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
