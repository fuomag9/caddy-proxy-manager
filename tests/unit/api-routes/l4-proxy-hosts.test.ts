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
      const { NextResponse: NR } = require('next/server');
      if (error instanceof ApiAuthError) {
        return NR.json({ error: error.message }, { status: error.status });
      }
      return NR.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
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

  it('returns 500 when host not found', async () => {
    mockUpdate.mockRejectedValue(new Error('not found'));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { listen_port: 4444 } }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
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

  it('returns 500 when host not found', async () => {
    mockDelete.mockRejectedValue(new Error('not found'));

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});

describe('POST /api/v1/l4-proxy-hosts (all options)', () => {
  it('creates L4 host with all options', async () => {
    const fullBody = {
      name: "PostgreSQL Proxy",
      listen_addresses: [":5432"],
      matchers: ["db.example.com"],
      upstreams: ["db-primary:5432", "db-replica:5432"],
      protocol: "tcp",
      matcher_type: "tls_sni",
      tls_termination: true,
      proxy_protocol_version: "v2",
      enabled: true,
      load_balancer: {
        enabled: true,
        policy: "least_conn",
        tryDuration: "10s",
        tryInterval: "500ms",
        retries: 2,
        activeHealthCheck: {
          enabled: true,
          port: 5432,
          interval: "15s",
          timeout: "3s",
        },
        passiveHealthCheck: {
          enabled: true,
          failDuration: "30s",
          maxFails: 3,
          unhealthyLatency: "5s",
        },
      },
      dns_resolver: {
        enabled: true,
        resolvers: ["1.1.1.1"],
        fallbacks: [],
        timeout: "3s",
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
        allow_countries: [],
        allow_continents: [],
        allow_asns: [],
        allow_cidrs: [],
        allow_ips: [],
        trusted_proxies: [],
        fail_closed: true,
        response_status: 403,
        response_body: "Blocked",
        response_headers: {},
        redirect_url: "",
      },
      geoblock_mode: "override",
    };

    const returnValue = { id: 10, ...fullBody, created_at: '2026-03-26T00:00:00Z', updated_at: '2026-03-26T00:00:00Z' };
    mockCreate.mockResolvedValue(returnValue as any);

    const response = await POST(createMockRequest({ method: 'POST', body: fullBody }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(10);
    expect(mockCreate).toHaveBeenCalledWith(fullBody, 1);
  });

  it('creates UDP L4 host without TLS', async () => {
    const body = {
      name: "DNS Proxy",
      listen_addresses: [":53"],
      matchers: [],
      upstreams: ["dns:53"],
      protocol: "udp",
      matcher_type: "none",
      tls_termination: false,
      enabled: true,
    };

    const returnValue = { id: 11, ...body, created_at: '2026-03-26T00:00:00Z', updated_at: '2026-03-26T00:00:00Z' };
    mockCreate.mockResolvedValue(returnValue as any);

    const response = await POST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(11);
    expect(data.protocol).toBe("udp");
    expect(data.tls_termination).toBe(false);
    expect(data.matchers).toEqual([]);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('PUT /api/v1/l4-proxy-hosts/[id] (partial update)', () => {
  it('updates L4 host matcher and protocol', async () => {
    const partialBody = {
      matcher_type: "http_host",
      matchers: ["new.example.com"],
      proxy_protocol_version: "v1",
    };

    const updated = { ...sampleHost, ...partialBody };
    mockUpdate.mockResolvedValue(updated as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body: partialBody }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(1, partialBody, 1);
    expect(data.matcher_type).toBe("http_host");
    expect(data.matchers).toEqual(["new.example.com"]);
    expect(data.proxy_protocol_version).toBe("v1");
  });
});
