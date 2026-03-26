import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/certificates', () => ({
  listCertificates: vi.fn(),
  createCertificate: vi.fn(),
  getCertificate: vi.fn(),
  updateCertificate: vi.fn(),
  deleteCertificate: vi.fn(),
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

import { GET as listGET, POST } from '@/app/api/v1/certificates/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/v1/certificates/[id]/route';
import { listCertificates, createCertificate, getCertificate, updateCertificate, deleteCertificate } from '@/src/lib/models/certificates';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listCertificates);
const mockCreate = vi.mocked(createCertificate);
const mockGet = vi.mocked(getCertificate);
const mockUpdate = vi.mocked(updateCertificate);
const mockDelete = vi.mocked(deleteCertificate);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/certificates', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleCert = {
  id: 1,
  domains: ['secure.example.com'],
  type: 'acme',
  status: 'active',
  expires_at: '2027-01-01',
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/certificates', () => {
  it('returns list of certificates', async () => {
    mockList.mockResolvedValue([sampleCert] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleCert]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/certificates', () => {
  it('creates a certificate and returns 201', async () => {
    const body = { domains: ['new.example.com'], type: 'acme' };
    mockCreate.mockResolvedValue({ id: 2, ...body } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/certificates/[id]', () => {
  it('returns a certificate by id', async () => {
    mockGet.mockResolvedValue(sampleCert as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleCert);
  });

  it('returns 404 for non-existent certificate', async () => {
    mockGet.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('PUT /api/v1/certificates/[id]', () => {
  it('updates a certificate', async () => {
    const body = { domains: ['updated.example.com'] };
    mockUpdate.mockResolvedValue({ ...sampleCert, domains: ['updated.example.com'] } as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.domains).toEqual(['updated.example.com']);
    expect(mockUpdate).toHaveBeenCalledWith(1, body, 1);
  });
});

describe('DELETE /api/v1/certificates/[id]', () => {
  it('deletes a certificate', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(1, 1);
  });
});
