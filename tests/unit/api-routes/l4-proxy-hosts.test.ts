import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/l4-proxy-hosts', () => ({
  listL4ProxyHosts: vi.fn(),
  createL4ProxyHost: vi.fn(),
  getL4ProxyHost: vi.fn(),
  updateL4ProxyHost: vi.fn(),
  deleteL4ProxyHost: vi.fn(),
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

import { GET as listGET, POST } from '@/app/api/v1/l4-proxy-hosts/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/v1/l4-proxy-hosts/[id]/route';
import { listL4ProxyHosts, createL4ProxyHost, getL4ProxyHost, updateL4ProxyHost, deleteL4ProxyHost } from '@/src/lib/models/l4-proxy-hosts';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listL4ProxyHosts);
const mockCreate = vi.mocked(createL4ProxyHost);
const mockGet = vi.mocked(getL4ProxyHost);
const mockUpdate = vi.mocked(updateL4ProxyHost);
const mockDelete = vi.mocked(deleteL4ProxyHost);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/l4-proxy-hosts', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleHost = {
  id: 1,
  name: 'SSH Forward',
  listen_port: 2222,
  forward_host: '10.0.0.5',
  forward_port: 22,
  protocol: 'tcp',
  enabled: true,
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/l4-proxy-hosts', () => {
  it('returns list of L4 proxy hosts', async () => {
    mockList.mockResolvedValue([sampleHost] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleHost]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/l4-proxy-hosts', () => {
  it('creates an L4 proxy host and returns 201', async () => {
    const body = { name: 'New L4', listen_port: 3333, forward_host: '10.0.0.6', forward_port: 33 };
    mockCreate.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/l4-proxy-hosts/[id]', () => {
  it('returns an L4 proxy host by id', async () => {
    mockGet.mockResolvedValue(sampleHost as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleHost);
  });

  it('returns 404 for non-existent host', async () => {
    mockGet.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('PUT /api/v1/l4-proxy-hosts/[id]', () => {
  it('updates an L4 proxy host', async () => {
    const body = { listen_port: 4444 };
    mockUpdate.mockResolvedValue({ ...sampleHost, listen_port: 4444 } as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.listen_port).toBe(4444);
    expect(mockUpdate).toHaveBeenCalledWith(1, body, 1);
  });
});

describe('DELETE /api/v1/l4-proxy-hosts/[id]', () => {
  it('deletes an L4 proxy host', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(1, 1);
  });
});
