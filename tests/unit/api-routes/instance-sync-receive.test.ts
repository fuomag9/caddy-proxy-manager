import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/src/lib/caddy', () => ({
  applyCaddyConfig: vi.fn(),
}));

vi.mock('@/src/lib/instance-sync', () => ({
  applySyncPayload: vi.fn(),
  getInstanceMode: vi.fn().mockResolvedValue('slave'),
  getSlaveMasterToken: vi.fn().mockResolvedValue('sync-token'),
  setSlaveLastSync: vi.fn(),
}));

import { POST } from '@/app/api/instances/sync/route';
import { applySyncPayload } from '@/src/lib/instance-sync';

const mockApplySyncPayload = vi.mocked(applySyncPayload);

function makePayload() {
  const now = new Date().toISOString();
  return {
    generated_at: now,
    settings: {},
    data: {
      certificates: [],
      caCertificates: [],
      issuedClientCertificates: [],
      accessLists: [],
      accessListEntries: [],
      proxyHosts: [
        {
          id: 1,
          name: 'Synced Host',
          domains: JSON.stringify(['synced.example.com']),
          upstreams: JSON.stringify(['backend:8080']),
          certificateId: null,
          accessListId: null,
          ownerUserId: null,
          sslForced: false,
          hstsEnabled: false,
          hstsSubdomains: false,
          allowWebsocket: false,
          preserveHostHeader: false,
          meta: null,
          enabled: true,
          createdAt: now,
          updatedAt: now,
          skipHttpsHostnameValidation: false,
        },
      ],
    },
  };
}

describe('POST /api/instances/sync', () => {
  it('accepts proxy hosts using the current proxy_hosts schema', async () => {
    const request = new NextRequest('http://localhost/api/instances/sync', {
      method: 'POST',
      headers: {
        authorization: 'Bearer sync-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(makePayload()),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockApplySyncPayload).toHaveBeenCalledOnce();
  });
});
