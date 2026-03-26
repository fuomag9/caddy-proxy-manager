import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/access-lists', () => ({
  listAccessLists: vi.fn(),
  createAccessList: vi.fn(),
  getAccessList: vi.fn(),
  updateAccessList: vi.fn(),
  deleteAccessList: vi.fn(),
  addAccessListEntry: vi.fn(),
  removeAccessListEntry: vi.fn(),
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

import { GET as listGET, POST as listPOST } from '@/app/api/v1/access-lists/route';
import { GET as getGET, PUT, DELETE } from '@/app/api/v1/access-lists/[id]/route';
import { POST as entriesPOST } from '@/app/api/v1/access-lists/[id]/entries/route';
import { DELETE as entryDELETE } from '@/app/api/v1/access-lists/[id]/entries/[entryId]/route';
import { listAccessLists, createAccessList, getAccessList, updateAccessList, deleteAccessList, addAccessListEntry, removeAccessListEntry } from '@/src/lib/models/access-lists';
import { requireApiAdmin } from '@/src/lib/api-auth';

const mockList = vi.mocked(listAccessLists);
const mockCreate = vi.mocked(createAccessList);
const mockGet = vi.mocked(getAccessList);
const mockUpdate = vi.mocked(updateAccessList);
const mockDelete = vi.mocked(deleteAccessList);
const mockAddEntry = vi.mocked(addAccessListEntry);
const mockRemoveEntry = vi.mocked(removeAccessListEntry);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/access-lists', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleList = {
  id: 1,
  name: 'Whitelist',
  type: 'allow',
  entries: [{ id: 1, value: '10.0.0.0/8', type: 'ip' }],
  created_at: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/access-lists', () => {
  it('returns list of access lists', async () => {
    mockList.mockResolvedValue([sampleList] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([sampleList]);
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/access-lists', () => {
  it('creates an access list and returns 201', async () => {
    const body = { name: 'New List', type: 'deny' };
    mockCreate.mockResolvedValue({ id: 2, ...body, entries: [] } as any);

    const response = await listPOST(createMockRequest({ method: 'POST', body }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(2);
    expect(mockCreate).toHaveBeenCalledWith(body, 1);
  });
});

describe('GET /api/v1/access-lists/[id]', () => {
  it('returns an access list by id', async () => {
    mockGet.mockResolvedValue(sampleList as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(sampleList);
  });

  it('returns 404 for non-existent access list', async () => {
    mockGet.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('PUT /api/v1/access-lists/[id]', () => {
  it('updates an access list', async () => {
    const body = { name: 'Updated List' };
    mockUpdate.mockResolvedValue({ ...sampleList, name: 'Updated List' } as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe('Updated List');
    expect(mockUpdate).toHaveBeenCalledWith(1, body, 1);
  });

  it('returns 500 when access list not found', async () => {
    mockUpdate.mockRejectedValue(new Error('not found'));

    const response = await PUT(createMockRequest({ method: 'PUT', body: { name: 'X' } }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});

describe('DELETE /api/v1/access-lists/[id]', () => {
  it('deletes an access list', async () => {
    mockDelete.mockResolvedValue(undefined as any);

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalledWith(1, 1);
  });

  it('returns 500 when access list not found', async () => {
    mockDelete.mockRejectedValue(new Error('not found'));

    const response = await DELETE(createMockRequest({ method: 'DELETE' }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('not found');
  });
});

describe('POST /api/v1/access-lists/[id]/entries', () => {
  it('adds an entry to an access list and returns 201', async () => {
    const body = { value: '192.168.0.0/16', type: 'ip' };
    const updatedList = { ...sampleList, entries: [...sampleList.entries, { id: 2, ...body }] };
    mockAddEntry.mockResolvedValue(updatedList as any);

    const response = await entriesPOST(createMockRequest({ method: 'POST', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.entries).toHaveLength(2);
    expect(mockAddEntry).toHaveBeenCalledWith(1, body, 1);
  });
});

describe('DELETE /api/v1/access-lists/[id]/entries/[entryId]', () => {
  it('removes an entry from an access list', async () => {
    const updatedList = { ...sampleList, entries: [] };
    mockRemoveEntry.mockResolvedValue(updatedList as any);

    const response = await entryDELETE(
      createMockRequest({ method: 'DELETE' }),
      { params: Promise.resolve({ id: '1', entryId: '1' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.entries).toHaveLength(0);
    expect(mockRemoveEntry).toHaveBeenCalledWith(1, 1, 1);
  });
});

describe('POST /api/v1/access-lists - with seed users', () => {
  it('creates access list with seed users', async () => {
    const input = {
      name: 'Staff',
      description: 'Staff access',
      users: [
        { username: 'alice', password: 'secret123' },
        { username: 'bob', password: 'pass456' },
      ],
    };
    mockCreate.mockResolvedValue({
      id: 3,
      ...input,
      entries: [],
      created_at: '2026-01-01T00:00:00Z',
    } as any);

    const response = await listPOST(createMockRequest({ method: 'POST', body: input }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.id).toBe(3);
    expect(data.name).toBe('Staff');
    expect(data.description).toBe('Staff access');
    expect(data.users).toHaveLength(2);
    expect(data.users[0].username).toBe('alice');
    expect(data.users[1].username).toBe('bob');
    expect(mockCreate).toHaveBeenCalledWith(input, 1);
  });
});

describe('POST /api/v1/access-lists/[id]/entries - with username and password', () => {
  it('adds entry with username and password', async () => {
    const entry = { username: 'charlie', password: 'newpass789' };
    const updatedList = {
      ...sampleList,
      entries: [...sampleList.entries, { id: 2, ...entry }],
    };
    mockAddEntry.mockResolvedValue(updatedList as any);

    const response = await entriesPOST(
      createMockRequest({ method: 'POST', body: entry }),
      { params: Promise.resolve({ id: '1' }) }
    );
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.entries).toHaveLength(2);
    expect(mockAddEntry).toHaveBeenCalledWith(1, entry, 1);
  });
});
