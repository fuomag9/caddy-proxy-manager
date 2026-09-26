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

  it('documents sync key pins on instances and the endpoints that manage them', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();
    const { paths, components } = data;

    expect(paths['/api/v1/instances/{id}/sync-key-pin'].delete.operationId).toBe('resetInstanceSyncKeyPin');
    expect(paths['/api/v1/instances/{id}/sync-key-pin'].delete.description).toContain('HTTP 405');
    expect(paths['/api/v1/instances/{id}/sync-key-pin'].put.operationId).toBe('pinInstanceSyncKey');
    expect(paths['/api/v1/instances/{id}/sync-key-pin'].put.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/SyncKeyPinInput' });
    expect(paths['/api/v1/instances/sync-key-pins'].get.responses['200'].content['application/json'].schema)
      .toEqual({ type: 'array', items: { $ref: '#/components/schemas/SyncKeyPinListing' } });
    expect(paths['/api/v1/instances/sync-key-pins'].put.operationId).toBe('pinSyncKey');
    for (const method of ['put', 'delete']) {
      expect(paths['/api/v1/instances/sync-key-pins'][method].parameters).toEqual([
        { $ref: '#/components/parameters/SyncKeyPinUrl' },
      ]);
    }
    expect(components.parameters.SyncKeyPinUrl).toMatchObject({ name: 'url', in: 'query', required: true });
    expect(paths['/api/v1/instances/{id}'].put.operationId).toBe('updateInstance');
    expect(paths['/api/v1/instances/{id}'].put.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/InstanceUpdate' });
    expect(components.schemas.InstanceUpdate.required).toBeUndefined();
    expect(paths['/api/v1/instances/sync-key'].get.responses['200'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/InstanceSyncKey' });

    expect(components.schemas.Instance.properties.syncKeyPin.oneOf).toEqual([
      { $ref: '#/components/schemas/SyncKeyPin' },
      { type: 'null' },
    ]);
    expect(components.schemas.Instance.required).toContain('syncKeyPin');
    expect(components.schemas.SyncKeyPin.required).toEqual(['keyId', 'publicKey', 'pinnedAt', 'source']);
    // Any source is kept as stored; these are the ones this release writes or reports.
    expect(components.schemas.SyncKeyPin.properties.source.enum).toBeUndefined();
    expect(components.schemas.SyncKeyPin.properties.source.examples).toEqual(['first-use', 'rotation', 'manual', 'unreadable']);
    expect(components.schemas.SyncKeyPinInput.required).toEqual(['publicKey']);

    // Every reference of the instance endpoints and their schemas resolves.
    const instanceDocs = {
      paths: Object.entries(paths).filter(([path]) => path.startsWith('/api/v1/instances')),
      schemas: ['Instance', 'InstanceUpdate', 'SyncKeyPin', 'SyncKeyPinInput', 'SyncKeyPinListing', 'InstanceSyncKey']
        .map((name) => components.schemas[name]),
    };
    const refs = JSON.stringify(instanceDocs).match(/"\$ref":"#\/components\/[^"]+"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      const path = JSON.parse(`{${ref}}`).$ref.slice('#/'.length).split('/');
      expect(path.reduce((node: any, key: string) => node?.[key], data), ref).toBeDefined();
    }
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

  it('documents DNS credentials and certificate private keys as write-only', async () => {
    const response = await GET(makeRequest());
    const data = await response.json();

    const certificateOutput = data.components.schemas.Certificate.properties;
    const certificateInput = data.components.schemas.CertificateInput.properties;
    expect(certificateOutput.privateKeyPem).toBeUndefined();
    expect(certificateOutput.hasPrivateKey).toBeDefined();
    expect(certificateOutput.providerOptions.additionalProperties).toBe(false);
    expect(certificateInput.providerOptions.additionalProperties).toBe(false);
    expect(certificateInput.privateKeyPem).toBeDefined();
    expect(certificateInput.privateKeyPem.writeOnly).toBe(true);
    expect(data.components.schemas.CloudflareSettings.properties.apiToken.writeOnly).toBe(true);
    expect(
      data.components.schemas.DnsProviderSettings.properties.providers
        .additionalProperties.additionalProperties.writeOnly
    ).toBe(true);

    const getSettingsSchemas = data.paths['/api/v1/settings/{group}'].get
      .responses['200'].content['application/json'].schema.oneOf;
    const putSettingsSchemas = data.paths['/api/v1/settings/{group}'].put
      .requestBody.content['application/json'].schema.oneOf;
    expect(getSettingsSchemas).toContainEqual({ $ref: '#/components/schemas/DnsProviderStatus' });
    expect(getSettingsSchemas).not.toContainEqual({ $ref: '#/components/schemas/DnsProviderSettings' });
    expect(putSettingsSchemas).toContainEqual({ $ref: '#/components/schemas/DnsProviderSettings' });
    expect(getSettingsSchemas).toContainEqual({ $ref: '#/components/schemas/CloudflareStatus' });
    expect(getSettingsSchemas).not.toContainEqual({ $ref: '#/components/schemas/CloudflareSettings' });
    expect(putSettingsSchemas).toContainEqual({ $ref: '#/components/schemas/CloudflareSettings' });
  });
});
