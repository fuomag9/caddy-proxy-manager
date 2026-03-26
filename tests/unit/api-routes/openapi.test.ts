import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/v1/openapi.json/route';

describe('GET /api/v1/openapi.json', () => {
  it('returns 200', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it('returns valid JSON with openapi field = "3.1.0"', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data.openapi).toBe('3.1.0');
  });

  it('contains all expected paths', async () => {
    const response = await GET();
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
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('has components.schemas defined', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data.components).toBeDefined();
    expect(data.components.schemas).toBeDefined();
    expect(Object.keys(data.components.schemas).length).toBeGreaterThan(0);
  });
});
