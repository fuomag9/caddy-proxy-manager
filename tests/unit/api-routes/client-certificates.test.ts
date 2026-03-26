import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/issued-client-certificates', () => ({
  listIssuedClientCertificates: vi.fn(),
  createIssuedClientCertificate: vi.fn(),
  getIssuedClientCertificate: vi.fn(),
  revokeIssuedClientCertificate: vi.fn(),
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

import { GET as listGET, POST } from '@/app/api/v1/client-certificates/route';
import { GET as getGET, DELETE } from '@/app/api/v1/client-certificates/[id]/route';
import { listIssuedClientCertificates, createIssuedClientCertificate, getIssuedClientCertificate, revokeIssuedClientCertificate } from '@/src/lib/models/issued-client-certificates';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listIssuedClientCertificates);
const mockCreate = vi.mocked(createIssuedClientCertificate);
const mockGet = vi.mocked(getIssuedClientCertificate);
const mockRevoke = vi.mocked(revokeIssuedClientCertificate);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/client-certificates', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleClientCert = {
  id: 1,
  common_name: 'client1.example.com',
  ca_certificate_id: 1,
  status: 'active',
  expires_at: '2027-06-01',
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/client-certificates', () => {
  it('returns list of client certificates', async () => {
    mockList.mockResolvedValue([sampleClientCert] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleClientCert]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/client-certificates', () => {
  it('creates a client certificate and returns 201', async () => {
    const body = { common_name: 'client2.example.com', ca_certificate_id: 1 };
    mockCreate.mockResolvedValue({ id: 2, ...body, status: 'active' } as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/client-certificates/[id]', () => {
  it('returns a client certificate by id', async () => {
    mockGet.mockResolvedValue(sampleClientCert as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleClientCert);
  });

  it('returns 404 for non-existent client certificate', async () => {
    mockGet.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('DELETE /api/v1/client-certificates/[id]', () => {
  it('revokes a client certificate and returns it', async () => {
    const revoked = { ...sampleClientCert, status: 'revoked' };
    mockRevoke.mockResolvedValue(revoked as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('revoked');
    expect(mockRevoke).toHaveBeenCalledWith(1, 1);
  });
});
