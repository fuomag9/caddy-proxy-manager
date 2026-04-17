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
  getDnsProviderSettings: vi.fn(),
  saveDnsProviderSettings: vi.fn(),
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
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
    }),
    ApiAuthError,
  };
});

import { GET, PUT } from '@/app/api/v1/settings/[group]/route';
import {
  getGeneralSettings, saveGeneralSettings,
  getCloudflareSettings, saveCloudflareSettings,
  getAuthentikSettings, saveAuthentikSettings,
  getMetricsSettings, saveMetricsSettings,
  getLoggingSettings, saveLoggingSettings,
  getDnsSettings, saveDnsSettings,
  getUpstreamDnsResolutionSettings, saveUpstreamDnsResolutionSettings,
  getGeoBlockSettings, saveGeoBlockSettings,
  getWafSettings, saveWafSettings,
} from '@/src/lib/settings';
import { getInstanceMode, setInstanceMode, getSlaveMasterToken, setSlaveMasterToken } from '@/src/lib/instance-sync';
import { applyCaddyConfig } from '@/src/lib/caddy';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockGetGeneral = vi.mocked(getGeneralSettings);
const mockSaveGeneral = vi.mocked(saveGeneralSettings);
const mockGetCloudflare = vi.mocked(getCloudflareSettings);
const mockSaveCloudflare = vi.mocked(saveCloudflareSettings);
const mockGetAuthentik = vi.mocked(getAuthentikSettings);
const mockSaveAuthentik = vi.mocked(saveAuthentikSettings);
const mockGetMetrics = vi.mocked(getMetricsSettings);
const mockSaveMetrics = vi.mocked(saveMetricsSettings);
const mockGetLogging = vi.mocked(getLoggingSettings);
const mockSaveLogging = vi.mocked(saveLoggingSettings);
const mockGetDns = vi.mocked(getDnsSettings);
const mockSaveDns = vi.mocked(saveDnsSettings);
const mockGetUpstreamDns = vi.mocked(getUpstreamDnsResolutionSettings);
const mockSaveUpstreamDns = vi.mocked(saveUpstreamDnsResolutionSettings);
const mockGetGeoBlock = vi.mocked(getGeoBlockSettings);
const mockSaveGeoBlock = vi.mocked(saveGeoBlockSettings);
const mockGetWaf = vi.mocked(getWafSettings);
const mockSaveWaf = vi.mocked(saveWafSettings);
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

    const validToken = 'a]b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
    const body = { token: validToken };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'sync-token' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSetSlaveMasterToken).toHaveBeenCalledWith(validToken);
  });

  it('clears sync token when null', async () => {
    mockSetSlaveMasterToken.mockResolvedValue(undefined as any);

    const body = {};
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'sync-token' }) });
    await response.json();

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

describe('GET cloudflare settings', () => {
  it('returns cloudflare settings', async () => {
    const settings = { apiToken: 'cf-token-xxx', zoneId: 'zone123', accountId: 'acc456' };
    mockGetCloudflare.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'cloudflare' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetCloudflare).toHaveBeenCalled();
  });
});

describe('PUT cloudflare settings', () => {
  it('saves cloudflare settings and applies caddy config', async () => {
    mockSaveCloudflare.mockResolvedValue(undefined);

    const body = { apiToken: 'new-token' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'cloudflare' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveCloudflare).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET authentik settings', () => {
  it('returns authentik settings', async () => {
    const settings = { outpostDomain: 'auth.example.com', outpostUpstream: 'http://authentik:9000', authEndpoint: '/outpost.goauthentik.io/auth/caddy' };
    mockGetAuthentik.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'authentik' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetAuthentik).toHaveBeenCalled();
  });
});

describe('PUT authentik settings', () => {
  it('saves authentik settings and applies caddy config', async () => {
    mockSaveAuthentik.mockResolvedValue(undefined);

    const body = { outpostDomain: 'auth.example.com', outpostUpstream: 'http://authentik:9000', authEndpoint: '/outpost.goauthentik.io/auth/caddy' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'authentik' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveAuthentik).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET metrics settings', () => {
  it('returns metrics settings', async () => {
    const settings = { enabled: true, port: 9090 };
    mockGetMetrics.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'metrics' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetMetrics).toHaveBeenCalled();
  });
});

describe('PUT metrics settings', () => {
  it('saves metrics settings and applies caddy config', async () => {
    mockSaveMetrics.mockResolvedValue(undefined);

    const body = { enabled: false };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'metrics' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveMetrics).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET logging settings', () => {
  it('returns logging settings', async () => {
    const settings = { enabled: true, format: 'json' };
    mockGetLogging.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'logging' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetLogging).toHaveBeenCalled();
  });
});

describe('PUT logging settings', () => {
  it('saves logging settings and applies caddy config', async () => {
    mockSaveLogging.mockResolvedValue(undefined);

    const body = { enabled: true, format: 'console' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'logging' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveLogging).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET dns settings', () => {
  it('returns dns settings', async () => {
    const settings = { enabled: true, resolvers: ['1.1.1.1', '8.8.8.8'], fallbacks: ['9.9.9.9'], timeout: '5s' };
    mockGetDns.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'dns' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetDns).toHaveBeenCalled();
  });
});

describe('PUT dns settings', () => {
  it('saves dns settings and applies caddy config', async () => {
    mockSaveDns.mockResolvedValue(undefined);

    const body = { enabled: true, resolvers: ['1.1.1.1', '8.8.8.8'], fallbacks: ['9.9.9.9'], timeout: '5s' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'dns' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveDns).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET upstream-dns settings', () => {
  it('returns upstream-dns settings', async () => {
    const settings = { enabled: true, family: 'ipv4' };
    mockGetUpstreamDns.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'upstream-dns' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetUpstreamDns).toHaveBeenCalled();
  });
});

describe('PUT upstream-dns settings', () => {
  it('saves upstream-dns settings and applies caddy config', async () => {
    mockSaveUpstreamDns.mockResolvedValue(undefined);

    const body = { enabled: true, family: 'both' };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'upstream-dns' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveUpstreamDns).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET geoblock settings', () => {
  it('returns geoblock settings', async () => {
    const settings = {
      enabled: true,
      block_countries: ['CN'],
      block_continents: [],
      block_asns: [],
      block_cidrs: [],
      block_ips: [],
      allow_countries: ['FI'],
      allow_continents: [],
      allow_asns: [],
      allow_cidrs: [],
      allow_ips: [],
      trusted_proxies: ['private_ranges'],
      fail_closed: false,
      response_status: 403,
      response_body: 'Forbidden',
      response_headers: {},
      redirect_url: '',
    };
    mockGetGeoBlock.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'geoblock' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetGeoBlock).toHaveBeenCalled();
  });
});

describe('PUT geoblock settings', () => {
  it('saves geoblock settings and applies caddy config', async () => {
    mockSaveGeoBlock.mockResolvedValue(undefined);

    const body = {
      enabled: true,
      block_countries: ['CN'],
      block_continents: [],
      block_asns: [],
      block_cidrs: [],
      block_ips: [],
      allow_countries: ['FI'],
      allow_continents: [],
      allow_asns: [],
      allow_cidrs: [],
      allow_ips: [],
      trusted_proxies: ['private_ranges'],
      fail_closed: false,
      response_status: 403,
      response_body: 'Forbidden',
      response_headers: {},
      redirect_url: '',
    };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'geoblock' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveGeoBlock).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});

describe('GET waf settings', () => {
  it('returns waf settings', async () => {
    const settings = { enabled: true, mode: 'On', load_owasp_crs: true, custom_directives: '', excluded_rule_ids: [920350] };
    mockGetWaf.mockResolvedValue(settings as any);

    const response = await GET(createMockRequest(), { params: Promise.resolve({ group: 'waf' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(settings);
    expect(mockGetWaf).toHaveBeenCalled();
  });
});

describe('PUT waf settings', () => {
  it('saves waf settings and applies caddy config', async () => {
    mockSaveWaf.mockResolvedValue(undefined);

    const body = { enabled: true, mode: 'On', load_owasp_crs: true, custom_directives: '', excluded_rule_ids: [920350] };
    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ group: 'waf' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockSaveWaf).toHaveBeenCalledWith(body);
    expect(mockApplyCaddyConfig).toHaveBeenCalled();
  });
});
