import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.hoisted(() => {
  process.env.INSTANCE_SYNC_RATE_MAX = '3';
});

vi.mock('@/src/lib/caddy', () => ({ applyCaddyConfig: vi.fn() }));

vi.mock('@/src/lib/instance-sync', () => ({
  applySyncPayload: vi.fn(),
  getInstanceMode: vi.fn().mockResolvedValue('slave'),
  getSlaveMasterToken: vi.fn().mockResolvedValue('sync-token'),
  setSlaveLastSync: vi.fn(),
}));

import { POST } from '@/app/api/instances/sync/route';

function syncRequest(headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/instances/sync', {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-token', 'content-type': 'application/json', ...headers },
    body: '{}',
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/instances/sync rate limit', () => {
  it('limits by the rightmost X-Forwarded-For entry and answers with Retry-After', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(syncRequest({ 'x-forwarded-for': `203.0.113.${i}, 192.0.2.10` }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(syncRequest({ 'x-forwarded-for': '203.0.113.99, 192.0.2.10' }));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);

    const other = await POST(syncRequest({ 'x-forwarded-for': '192.0.2.11' }));
    expect(other.status).toBe(401);
  });

  it('does not key clients on a client-supplied X-Real-IP', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(syncRequest({ 'x-real-ip': `198.51.100.${i}` }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(syncRequest({ 'x-real-ip': '198.51.100.99' }));
    expect(blocked.status).toBe(429);
  });

  it('uses a fixed window, so a client at the limit is refused only until the window ends', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now');
    const request = () => POST(syncRequest({ 'x-forwarded-for': '192.0.2.20' }));

    // Three requests per 60 s window, 20 s apart: the steady rate of the limit.
    for (let i = 0; i < 3; i++) {
      now.mockReturnValue(start + i * 20_000);
      expect((await request()).status).toBe(401);
    }
    now.mockReturnValue(start + 59_000);
    const blocked = await request();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('1');

    for (let i = 3; i < 6; i++) {
      now.mockReturnValue(start + i * 20_000);
      expect((await request()).status).toBe(401);
    }
  });

  it('keys clients on TRUSTED_CLIENT_IP_HEADER when it is set', async () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'x-real-ip');
    for (let i = 0; i < 3; i++) {
      const res = await POST(syncRequest({ 'x-real-ip': '198.51.100.50', 'x-forwarded-for': `203.0.113.${i}` }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(syncRequest({ 'x-real-ip': '198.51.100.50', 'x-forwarded-for': '203.0.113.60' }));
    expect(blocked.status).toBe(429);
    const other = await POST(syncRequest({ 'x-real-ip': '198.51.100.51', 'x-forwarded-for': '203.0.113.60' }));
    expect(other.status).toBe(401);
  });
});
