import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/settings', () => ({
  getGeneralSettings: vi.fn(),
  saveGeneralSettings: vi.fn(),
  getCloudflareSettings: vi.fn(),
  saveCloudflareSettings: vi.fn(),
  getAuthentikSettings: vi.fn(),
  saveAuthentikSettings: vi.fn(),
  getMetricsSettings: vi.fn(),
  saveMetricsSettings: vi.fn(),
  getLoggingSettings: vi.fn(),
  saveLoggingSettings: vi.fn(),
  getDnsSettings: vi.fn(),
  saveDnsSettings: vi.fn(),
  getUpstreamDnsResolutionSettings: vi.fn(),
  saveUpstreamDnsResolutionSettings: vi.fn(),
  getGeoBlockSettings: vi.fn(),
  saveGeoBlockSettings: vi.fn(),
  getWafSettings: vi.fn(),
  saveWafSettings: vi.fn(),
}));

vi.mock('@/src/lib/instance-sync', () => ({
  getInstanceMode: vi.fn(),
  setInstanceMode: vi.fn(),
  getSlaveMasterToken: vi.fn(),
  setSlaveMasterToken: vi.fn(),
}));

vi.mock('@/src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn().mockResolvedValue({ ok: true }),
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

import { GET, PUT } from '@/app/api/v1/settings/[group]/route';
import { getGeneralSettings, saveGeneralSettings } from '@/src/lib/settings';
import { getInstanceMode, setInstanceMode, getSlaveMasterToken, setSlaveMasterToken } from '@/src/lib/instance-sync';
import { applyCaddyConfig } from '@/src/lib/caddy';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockGetGeneral = vi.mocked(getGeneralSettings);
const mockSaveGeneral = vi.mocked(saveGeneralSettings);
const mockGetInstanceMode = vi.mocked(getInstanceMode);
const mockSetInstanceMode = vi.mocked(setInstanceMode);
const mockGetSlaveMasterToken = vi.mocked(getSlaveMasterToken);
const mockSetSlaveMasterToken = vi.mocked(setSlaveMasterToken);
const mockApplyCaddyConfig = vi.mocked(applyCaddyConfig);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/settings/general', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/settings/[group]', () => {
  it('returns general settings', async () => {
    const settings = { site_name: 'My Proxy', admin_email: 'admin@example.com' };
    mockGetGeneral.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'general' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
  });

  it('returns empty object when settings are null', async () => {
    mockGetGeneral.mockResolvedValue(null as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'general' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({});
  });

  it('returns instance mode', async () => {
    mockGetInstanceMode.mockResolvedValue('standalone' as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'instance-mode' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ mode: 'standalone' });
  });

  it('returns sync-token status', async () => {
    mockGetSlaveMasterToken.mockResolvedValue('some-token' as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'sync-token' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ has_token: true });
  });

  it('returns has_token false when no token', async () => {
    mockGetSlaveMasterToken.mockResolvedValue(null as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'sync-token' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ has_token: false });
  });

  it('returns 404 for unknown settings group', async () => {
    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'unknown' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Unknown settings group');
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'general' }) });
    expect(response.status).toBe(401);
  });
});

describe('PUT /api/v1/settings/[group]', () => {
  it('saves general settings and applies caddy config', async () => {
    mockSaveGeneral.mockResolvedValue(undefined);

    const body = { site_name: 'Updated Proxy' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'general' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveGeneral).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });

  it('sets instance mode', async () => {
    mockSetInstanceMode.mockResolvedValue(undefined as any);

    const body = { mode: 'master' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'instance-mode' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSetInstanceMode).toHaveBeenCalledWith('master');
  });

  it('sets sync token', async () => {
    mockSetSlaveMasterToken.mockResolvedValue(undefined as any);

    const body = { token: 'new-sync-token' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'sync-token' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSetSlaveMasterToken).toHaveBeenCalledWith('new-sync-token');
  });

  it('clears sync token when null', async () => {
    mockSetSlaveMasterToken.mockResolvedValue(undefined as any);

    const body = {};
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'sync-token' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockSetSlaveMasterToken).toHaveBeenCalledWith(null);
  });

  it('returns 404 for unknown settings group', async () => {
    const response = await PUT(createMockRequest({ method: 'PUT', body: {} }), { params: Promise.resolve({ group: 'unknown' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Unknown settings group');
  });

  it('still returns ok even if applyCaddyConfig fails', async () => {
    mockSaveGeneral.mockResolvedValue(undefined);
    mockApplyCaddyConfig.mockRejectedValue(new Error('caddy down'));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { site_name: 'Test' } }), { params: Promise.resolve({ group: 'general' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
  });
});
