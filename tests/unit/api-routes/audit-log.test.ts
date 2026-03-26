import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/audit', () => ({
  listAuditEvents: vi.fn(),
  countAuditEvents: vi.fn(),
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

import { GET } from '@/app/api/v1/audit-log/route';
import { listAuditEvents, countAuditEvents } from '@/src/lib/models/audit';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockListAuditEvents = vi.mocked(listAuditEvents);
const mockCountAuditEvents = vi.mocked(countAuditEvents);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { searchParams?: string } = {}): any {
  return {
    headers: { get: () => null },
    method: 'GET',
    nextUrl: { pathname: '/api/v1/audit-log', searchParams: new URLSearchParams(options.searchParams ?? '') },
    json: async () => ({}),
  };
}

const sampleEvents = [
  { id: 1, action: 'proxy_host.create', user_id: 1, details: '{}', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, action: 'certificate.create', user_id: 1, details: '{}', created_at: '2026-01-01T01:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/audit-log', () => {
  it('returns paginated events with total', async () => {
    mockListAuditEvents.mockResolvedValue(sampleEvents as any);
    mockCountAuditEvents.mockResolvedValue(2);

    const response = await GET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.events).toEqual(sampleEvents);
    expect(data.total).toBe(2);
    expect(data.page).toBe(1);
    expect(data.perPage).toBe(50);
    expect(mockListAuditEvents).toHaveBeenCalledWith(50, 0, undefined);
    expect(mockCountAuditEvents).toHaveBeenCalledWith(undefined);
  });

  it('parses page and per_page params', async () => {
    mockListAuditEvents.mockResolvedValue([]);
    mockCountAuditEvents.mockResolvedValue(100);

    const response = await GET(createMockRequest({ searchParams: 'page=3&per_page=25' }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.page).toBe(3);
    expect(data.perPage).toBe(25);
    expect(mockListAuditEvents).toHaveBeenCalledWith(25, 50, undefined);
  });

  it('passes search param through', async () => {
    mockListAuditEvents.mockResolvedValue([]);
    mockCountAuditEvents.mockResolvedValue(0);

    await GET(createMockRequest({ searchParams: 'search=proxy' }));

    expect(mockListAuditEvents).toHaveBeenCalledWith(50, 0, 'proxy');
    expect(mockCountAuditEvents).toHaveBeenCalledWith('proxy');
  });

  it('clamps per_page to max 200', async () => {
    mockListAuditEvents.mockResolvedValue([]);
    mockCountAuditEvents.mockResolvedValue(0);

    await GET(createMockRequest({ searchParams: 'per_page=500' }));

    expect(mockListAuditEvents).toHaveBeenCalledWith(200, 0, undefined);
  });

  it('clamps per_page to min 1', async () => {
    mockListAuditEvents.mockResolvedValue([]);
    mockCountAuditEvents.mockResolvedValue(0);

    await GET(createMockRequest({ searchParams: 'per_page=0' }));

    expect(mockListAuditEvents).toHaveBeenCalledWith(50, 0, undefined);
  });

  it('clamps page to min 1', async () => {
    mockListAuditEvents.mockResolvedValue([]);
    mockCountAuditEvents.mockResolvedValue(0);

    await GET(createMockRequest({ searchParams: 'page=-1' }));

    expect(mockListAuditEvents).toHaveBeenCalledWith(50, 0, undefined);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await GET(createMockRequest());
    expect(response.status).toBe(401);
  });
});
