import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/ca-certificates', () => ({
  listCaCertificates: vi.fn(),
  createCaCertificate: vi.fn(),
  getCaCertificate: vi.fn(),
  updateCaCertificate: vi.fn(),
  deleteCaCertificate: vi.fn(),
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

import { GET as listGET, POST } from '@/app/api/v1/ca-certificates/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/v1/ca-certificates/[id]/route';
import { listCaCertificates, createCaCertificate, getCaCertificate, updateCaCertificate, deleteCaCertificate } from '@/src/lib/models/ca-certificates';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listCaCertificates);
const mockCreate = vi.mocked(createCaCertificate);
const mockGet = vi.mocked(getCaCertificate);
const mockUpdate = vi.mocked(updateCaCertificate);
const mockDelete = vi.mocked(deleteCaCertificate);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/ca-certificates', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleCaCert = {
  id: 1,
  name: 'Internal CA',
  certificate: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----',
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/ca-certificates', () => {
  it('returns list of CA certificates', async () => {
    mockList.mockResolvedValue([sampleCaCert] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleCaCert]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/ca-certificates', () => {
  it('creates a CA certificate and returns 201', async () => {
    const body = { name: 'New CA', certificate: '---CERT---', private_key: '---KEY---' };
    mockCreate.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/ca-certificates/[id]', () => {
  it('returns a CA certificate by id', async () => {
    mockGet.mockResolvedValue(sampleCaCert as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleCaCert);
  });

  it('returns 404 for non-existent CA certificate', async () => {
    mockGet.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('PUT /api/v1/ca-certificates/[id]', () => {
  it('updates a CA certificate', async () => {
    const body = { name: 'Updated CA' };
    mockUpdate.mockResolvedValue({ ...sampleCaCert, name: 'Updated CA' } as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe('Updated CA');
    expect(mockUpdate).toHaveBeenCalledWith(1, body, 1);
  });

  it('returns 500 when CA certificate not found', async () => {
    mockUpdate.mockRejectedValue(new Error('not found'));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { name: 'X' } }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});

describe('DELETE /api/v1/ca-certificates/[id]', () => {
  it('deletes a CA certificate', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(1, 1);
  });

  it('returns 500 when CA certificate not found', async () => {
    mockDelete.mockRejectedValue(new Error('not found'));

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});
