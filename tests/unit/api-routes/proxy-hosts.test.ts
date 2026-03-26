import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/proxy-hosts', () => ({
  listProxyHosts: vi.fn(),
  createProxyHost: vi.fn(),
  getProxyHost: vi.fn(),
  updateProxyHost: vi.fn(),
  deleteProxyHost: vi.fn(),
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

import { GET as listGET, POST } from '@/app/api/v1/proxy-hosts/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/v1/proxy-hosts/[id]/route';
import { listProxyHosts, createProxyHost, getProxyHost, updateProxyHost, deleteProxyHost } from '@/src/lib/models/proxy-hosts';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockListProxyHosts = vi.mocked(listProxyHosts);
const mockCreateProxyHost = vi.mocked(createProxyHost);
const mockGetProxyHost = vi.mocked(getProxyHost);
const mockUpdateProxyHost = vi.mocked(updateProxyHost);
const mockDeleteProxyHost = vi.mocked(deleteProxyHost);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/proxy-hosts', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleHost = {
  id: 1,
  domains: ['example.com'],
  forward_host: '10.0.0.1',
  forward_port: 8080,
  forward_scheme: 'http',
  enabled: true,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/proxy-hosts', () => {
  it('returns list of proxy hosts', async () => {
    mockListProxyHosts.mockResolvedValue([sampleHost] as any);

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

describe('POST /api/v1/proxy-hosts', () => {
  it('creates a proxy host and returns 201', async () => {
    const body = { domains: ['new.example.com'], forward_host: '10.0.0.2', forward_port: 3000 };
    mockCreateProxyHost.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreateProxyHost).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/proxy-hosts/[id]', () => {
  it('returns a proxy host by id', async () => {
    mockGetProxyHost.mockResolvedValue(sampleHost as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleHost);
    expect(mockGetProxyHost).toHaveBeenCalledWith(1);
  });

  it('returns 404 for non-existent host', async () => {
    mockGetProxyHost.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('PUT /api/v1/proxy-hosts/[id]', () => {
  it('updates a proxy host', async () => {
    const body = { forward_port: 9090 };
    const updated = { ...sampleHost, forward_port: 9090 };
    mockUpdateProxyHost.mockResolvedValue(updated as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.forward_port).toBe(9090);
    expect(mockUpdateProxyHost).toHaveBeenCalledWith(1, body, 1);
  });
});

describe('DELETE /api/v1/proxy-hosts/[id]', () => {
  it('deletes a proxy host', async () => {
    mockDeleteProxyHost.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDeleteProxyHost).toHaveBeenCalledWith(1, 1);
  });
});
