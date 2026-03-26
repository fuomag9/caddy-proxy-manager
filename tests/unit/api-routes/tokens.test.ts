import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/api-tokens', () => ({
  createApiToken: vi.fn(),
  listApiTokens: vi.fn(),
  listAllApiTokens: vi.fn(),
  deleteApiToken: vi.fn(),
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

import { GET, POST } from '@/app/api/v1/tokens/route';
import { DELETE } from '@/app/api/v1/tokens/[id]/route';
import { createApiToken, listApiTokens, listAllApiTokens, deleteApiToken } from '@/src/lib/models/api-tokens';
import { requireApiUser } from '@/src/lib/api-auth';

const mockCreateApiToken = vi.mocked(createApiToken);
const mockListApiTokens = vi.mocked(listApiTokens);
const mockListAllApiTokens = vi.mocked(listAllApiTokens);
const mockDeleteApiToken = vi.mocked(deleteApiToken);
const mockRequireApiUser = vi.mocked(requireApiUser);

function createMockRequest(options: { method?: string; body?: unknown; authorization?: string; searchParams?: string } = {}): any {
  return {
    headers: {
      get(name: string) {
        if (name === 'authorization') return options.authorization ?? 'Bearer test-token';
        return null;
      },
    },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/tokens', searchParams: new URLSearchParams(options.searchParams ?? '') },
    json: async () => options.body ?? {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiUser.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/tokens', () => {
  it('returns all tokens for admin', async () => {
    const tokens = [
      { id: 1, name: 'Token 1', created_by: 1, created_at: '2026-01-01', last_used_at: null, expires_at: null },
      { id: 2, name: 'Token 2', created_by: 2, created_at: '2026-01-02', last_used_at: null, expires_at: null },
    ];
    mockListAllApiTokens.mockResolvedValue(tokens as any);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(tokens);
    expect(mockListAllApiTokens).toHaveBeenCalled();
    expect(mockListApiTokens).not.toHaveBeenCalled();
  });

  it('returns own tokens for non-admin user', async () => {
    mockRequireApiUser.mockResolvedValue({ userId: 5, role: 'user', authMethod: 'bearer' });
    const tokens = [{ id: 3, name: 'My Token', created_by: 5, created_at: '2026-01-01', last_used_at: null, expires_at: null }];
    mockListApiTokens.mockResolvedValue(tokens as any);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(tokens);
    expect(mockListApiTokens).toHaveBeenCalledWith(5);
    expect(mockListAllApiTokens).not.toHaveBeenCalled();
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiUser.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });
});

describe('POST /api/v1/tokens', () => {
  it('creates a token and returns 201', async () => {
    const tokenResult = {
      token: { id: 10, name: 'New Token', created_by: 1, created_at: '2026-01-01', last_used_at: null, expires_at: null },
      rawToken: 'cpm_raw_token_abc123',
    };
    mockCreateApiToken.mockResolvedValue(tokenResult as any);

    const response = await POST(createMockRequest({ method: 'POST', body: { name: 'New Token' } }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.raw_token).toBe('cpm_raw_token_abc123');
    expect(data.token).toEqual(tokenResult.token);
    expect(mockCreateApiToken).toHaveBeenCalledWith('New Token', 1, undefined);
  });

  it('creates a token with expires_at', async () => {
    const tokenResult = {
      token: { id: 11, name: 'Expiring Token', created_by: 1, created_at: '2026-01-01', last_used_at: null, expires_at: '2027-01-01' },
      rawToken: 'cpm_raw_token_xyz',
    };
    mockCreateApiToken.mockResolvedValue(tokenResult as any);

    const response = await POST(createMockRequest({ method: 'POST', body: { name: 'Expiring Token', expires_at: '2027-01-01' } }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(mockCreateApiToken).toHaveBeenCalledWith('Expiring Token', 1, '2027-01-01');
  });

  it('returns 400 when name is missing', async () => {
    const response = await POST(createMockRequest({ method: 'POST', body: {} }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('name is required');
  });

  it('returns 400 when name is not a string', async () => {
    const response = await POST(createMockRequest({ method: 'POST', body: { name: 123 } }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('name is required');
  });
});

describe('DELETE /api/v1/tokens/[id]', () => {
  it('deletes a token and returns ok', async () => {
    mockDeleteApiToken.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDeleteApiToken).toHaveBeenCalledWith(5, 1);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiUser.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });
});
