import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/lib/api-auth', () => {
  const ApiAuthError = class extends Error {
    status: number;
    constructor(msg: string, status: number) { super(msg); this.status = status; this.name = 'ApiAuthError'; }
  };
  return {
    requireApiAdmin: vi.fn().mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' }),
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

import { GET } from '@/app/api/v1/openapi.json/route';

function makeRequest() {
  return new NextRequest('http://localhost/api/v1/openapi.json', {
    headers: { authorization: 'Bearer test-token' },
  });
}

describe('GET /api/v1/openapi.json', () => {
  it('returns 200', async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
  });

  it('returns valid JSON with openapi field = "3.1.0"', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();
    expect(data.openapi).toBe('3.1.0');
  });

  it('contains all expected paths', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();
    const paths = Object.keys(data.paths);

    expect(paths).toContain('/api/v1/tokens');
    expect(paths).toContain('/api/v1/proxy-hosts');
    expect(paths).toContain('/api/v1/l4-proxy-hosts');
    expect(paths).toContain('/api/v1/certificates');
    expect(paths).toContain('/api/v1/ca-certificates');
    expect(paths).toContain('/api/v1/client-certificates');
    expect(paths).toContain('/api/v1/access-lists');
    expect(paths).toContain('/api/v1/settings/{group}');
    expect(paths).toContain('/api/v1/instances');
    expect(paths).toContain('/api/v1/users');
    expect(paths).toContain('/api/v1/audit-log');
    expect(paths).toContain('/api/v1/caddy/apply');
  });

  it('has Cache-Control header', async () => {
    const response = await GET(makeRequest());
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('has components.schemas defined', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();
    expect(data.components).toBeDefined();
    expect(data.components.schemas).toBeDefined();
    expect(Object.keys(data.components.schemas).length).toBeGreaterThan(0);
  });
});
