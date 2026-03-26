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
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
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

  it('returns 500 when host not found', async () => {
    mockUpdateProxyHost.mockRejectedValue(new Error('not found'));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { forward_port: 9090 } }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
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

  it('returns 500 when host not found', async () => {
    mockDeleteProxyHost.mockRejectedValue(new Error('not found'));

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});

describe('POST /api/v1/proxy-hosts (all optional fields)', () => {
  it('creates proxy host with all optional fields', async () => {
    const fullBody = {
      name: "Full Featured Host",
      domains: ["app.example.com", "www.example.com"],
      upstreams: ["10.0.0.1:8080", "10.0.0.2:8080"],
      certificate_id: 5,
      access_list_id: 2,
      ssl_forced: true,
      hsts_enabled: true,
      hsts_subdomains: true,
      allow_websocket: true,
      preserve_host_header: true,
      skip_https_hostname_validation: false,
      enabled: true,
      custom_reverse_proxy_json: '{"flush_interval": -1}',
      custom_pre_handlers_json: null,
      authentik: {
        enabled: true,
        outpostDomain: "auth.example.com",
        outpostUpstream: "http://authentik:9000",
        authEndpoint: null,
        copyHeaders: ["X-Authentik-Username", "X-Authentik-Email"],
        trustedProxies: ["private_ranges"],
        setOutpostHostHeader: true,
        protectedPaths: null,
      },
      load_balancer: {
        enabled: true,
        policy: "round_robin",
        policyHeaderField: null,
        policyCookieName: null,
        policyCookieSecret: null,
        tryDuration: "5s",
        tryInterval: "250ms",
        retries: 3,
        activeHealthCheck: {
          enabled: true,
          uri: "/health",
          port: null,
          interval: "30s",
          timeout: "5s",
          status: 200,
          body: null,
        },
        passiveHealthCheck: {
          enabled: true,
          failDuration: "30s",
          maxFails: 5,
          unhealthyStatus: [502, 503],
          unhealthyLatency: "10s",
        },
      },
      dns_resolver: {
        enabled: true,
        resolvers: ["1.1.1.1", "8.8.8.8"],
        fallbacks: ["9.9.9.9"],
        timeout: "5s",
      },
      upstream_dns_resolution: {
        enabled: true,
        family: "ipv4",
      },
      geoblock: {
        enabled: true,
        block_countries: ["CN", "RU"],
        block_continents: [],
        block_asns: [12345],
        block_cidrs: [],
        block_ips: [],
        allow_countries: ["US", "FI"],
        allow_continents: [],
        allow_asns: [],
        allow_cidrs: ["10.0.0.0/8"],
        allow_ips: [],
        trusted_proxies: ["private_ranges"],
        fail_closed: false,
        response_status: 403,
        response_body: "Access denied",
        response_headers: {},
        redirect_url: "",
      },
      geoblock_mode: "merge",
      waf: {
        enabled: true,
        mode: "On",
        load_owasp_crs: true,
        custom_directives: 'SecRule REQUEST_URI "@contains /admin" "id:1001,deny,status:403"',
        excluded_rule_ids: [920350, 942100],
        waf_mode: "merge",
      },
      mtls: {
        enabled: true,
        ca_certificate_ids: [1, 3],
      },
      redirects: [
        { from: "/.well-known/carddav", to: "/remote.php/dav/", status: 301 },
        { from: "/old-path", to: "/new-path", status: 308 },
      ],
      rewrite: {
        path_prefix: "/api",
      },
    };

    const returnValue = { id: 99, ...fullBody, created_at: '2026-03-26T00:00:00Z', updated_at: '2026-03-26T00:00:00Z' };
    mockCreateProxyHost.mockResolvedValue(returnValue as any);

    const response = await POST(createMockRequest({ method: 'POST', body: fullBody }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(99);
    expect(mockCreateProxyHost).toHaveBeenCalledWith(fullBody, 1);
  });
});

describe('PUT /api/v1/proxy-hosts/[id] (partial fields)', () => {
  it('updates proxy host with partial fields', async () => {
    const partialBody = {
      ssl_forced: false,
      waf: { enabled: false, mode: "Off", load_owasp_crs: false, custom_directives: "", excluded_rule_ids: [] },
      redirects: [],
    };

    const updated = { ...sampleHost, ...partialBody };
    mockUpdateProxyHost.mockResolvedValue(updated as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body: partialBody }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdateProxyHost).toHaveBeenCalledWith(1, partialBody, 1);
    expect(data.ssl_forced).toBe(false);
    expect(data.waf).toEqual(partialBody.waf);
    expect(data.redirects).toEqual([]);
  });
});

describe('GET /api/v1/proxy-hosts/[id] (all nested fields)', () => {
  it('returns proxy host with all nested fields', async () => {
    const fullHost = {
      id: 42,
      name: "Full Host",
      domains: ["app.example.com"],
      upstreams: ["10.0.0.1:8080"],
      certificate_id: 5,
      access_list_id: 2,
      ssl_forced: true,
      hsts_enabled: true,
      hsts_subdomains: true,
      allow_websocket: true,
      preserve_host_header: true,
      skip_https_hostname_validation: false,
      enabled: true,
      custom_reverse_proxy_json: '{"flush_interval": -1}',
      custom_pre_handlers_json: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      authentik: {
        enabled: true,
        outpostDomain: "auth.example.com",
        outpostUpstream: "http://authentik:9000",
        authEndpoint: null,
        copyHeaders: ["X-Authentik-Username"],
        trustedProxies: ["private_ranges"],
        setOutpostHostHeader: true,
        protectedPaths: null,
      },
      load_balancer: {
        enabled: true,
        policy: "round_robin",
        policyHeaderField: null,
        policyCookieName: null,
        policyCookieSecret: null,
        tryDuration: "5s",
        tryInterval: "250ms",
        retries: 3,
        activeHealthCheck: {
          enabled: true,
          uri: "/health",
          port: null,
          interval: "30s",
          timeout: "5s",
          status: 200,
          body: null,
        },
        passiveHealthCheck: {
          enabled: true,
          failDuration: "30s",
          maxFails: 5,
          unhealthyStatus: [502, 503],
          unhealthyLatency: "10s",
        },
      },
      dns_resolver: {
        enabled: true,
        resolvers: ["1.1.1.1"],
        fallbacks: [],
        timeout: "5s",
      },
      upstream_dns_resolution: {
        enabled: true,
        family: "ipv4",
      },
      geoblock: {
        enabled: true,
        block_countries: ["CN"],
        block_continents: [],
        block_asns: [],
        block_cidrs: [],
        block_ips: [],
        allow_countries: ["FI"],
        allow_continents: [],
        allow_asns: [],
        allow_cidrs: [],
        allow_ips: [],
        trusted_proxies: ["private_ranges"],
        fail_closed: false,
        response_status: 403,
        response_body: "Blocked",
        response_headers: {},
        redirect_url: "",
      },
      geoblock_mode: "merge",
      waf: {
        enabled: true,
        mode: "On",
        load_owasp_crs: true,
        custom_directives: "",
        excluded_rule_ids: [],
        waf_mode: "merge",
      },
      mtls: {
        enabled: true,
        ca_certificate_ids: [1],
      },
      redirects: [
        { from: "/old", to: "/new", status: 301 },
      ],
      rewrite: {
        path_prefix: "/api",
      },
    };

    mockGetProxyHost.mockResolvedValue(fullHost as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '42' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(fullHost);
    expect(data.authentik.enabled).toBe(true);
    expect(data.authentik.outpostDomain).toBe("auth.example.com");
    expect(data.load_balancer.policy).toBe("round_robin");
    expect(data.load_balancer.activeHealthCheck.uri).toBe("/health");
    expect(data.load_balancer.passiveHealthCheck.maxFails).toBe(5);
    expect(data.dns_resolver.resolvers).toEqual(["1.1.1.1"]);
    expect(data.upstream_dns_resolution.family).toBe("ipv4");
    expect(data.geoblock.block_countries).toEqual(["CN"]);
    expect(data.waf.mode).toBe("On");
    expect(data.mtls.ca_certificate_ids).toEqual([1]);
    expect(data.redirects).toHaveLength(1);
    expect(data.rewrite.path_prefix).toBe("/api");
    expect(mockGetProxyHost).toHaveBeenCalledWith(42);
  });
});
