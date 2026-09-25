import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/lib/models/user', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  getUserById: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
  deleteUser: vi.fn(),
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

import { GET as listGET, POST as createPOST } from '@/app/api/v1/users/route';
import { GET as getGET, PUT } from '@/app/api/v1/users/[id]/route';
import { listUsers, createUser, getUserById, updateUserProfile } from '@/src/lib/models/user';
import { requireApiAdmin, requireApiUser } from '@/src/lib/api-auth';

const mockListUsers = vi.mocked(listUsers);
const mockGetUserById = vi.mocked(getUserById);
const mockUpdateUserProfile = vi.mocked(updateUserProfile);
const mockRequireApiAdmin = vi.mocked(requireApiAdmin);
const mockRequireApiUser = vi.mocked(requireApiUser);

function createMockRequest(options: { method?: string; body?: unknown } = {}): any {
  return {
    headers: { get: () => null },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/users', searchParams: new URLSearchParams() },
    json: async () => options.body ?? {},
  };
}

const sampleUser = {
  id: 1,
  name: 'Admin User',
  email: 'admin@example.com',
  role: 'admin',
  passwordHash: '$2b$10$hashedpassword',
  createdAt: '2026-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAdmin.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
  mockRequireApiUser.mockResolvedValue({ userId: 1, role: 'admin', authMethod: 'bearer' });
});

describe('GET /api/v1/users', () => {
  it('returns list of users with passwordHash stripped', async () => {
    mockListUsers.mockResolvedValue([sampleUser] as any);

    const response = await listGET(createMockRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(1);
    expect(data[0]).not.toHaveProperty('passwordHash');
    expect(data[0].name).toBe('Admin User');
    expect(data[0].email).toBe('admin@example.com');
  });

  it('returns 401 on auth failure', async () => {
    const { ApiAuthError } = await import('@/src/lib/api-auth');
    mockRequireApiAdmin.mockRejectedValue(new ApiAuthError('Unauthorized', 401));

    const response = await listGET(createMockRequest());
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/users/[id]', () => {
  it('returns a user by id with passwordHash stripped', async () => {
    mockGetUserById.mockResolvedValue(sampleUser as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).not.toHaveProperty('passwordHash');
    expect(data.name).toBe('Admin User');
  });

  it('returns 404 for non-existent user', async () => {
    mockGetUserById.mockResolvedValue(null as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });

  it('returns 403 when non-admin tries to view another user', async () => {
    mockRequireApiUser.mockResolvedValue({ userId: 5, role: 'user', authMethod: 'bearer' });

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe('Forbidden');
  });

  it('allows non-admin to view themselves', async () => {
    mockRequireApiUser.mockResolvedValue({ userId: 5, role: 'user', authMethod: 'bearer' });
    const user = { ...sampleUser, id: 5, role: 'user' };
    mockGetUserById.mockResolvedValue(user as any);

    const response = await getGET(createMockRequest(), { params: Promise.resolve({ id: '5' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe(5);
    expect(data).not.toHaveProperty('passwordHash');
  });
});

describe('PUT /api/v1/users/[id]', () => {
  it('updates a user profile', async () => {
    const body = { name: 'Updated Name' };
    const updated = { ...sampleUser, name: 'Updated Name' };
    mockUpdateUserProfile.mockResolvedValue(updated as any);
    mockGetUserById.mockResolvedValue(updated as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body }), { params: Promise.resolve({ id: '1' }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe('Updated Name');
    expect(data).not.toHaveProperty('passwordHash');
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(1, { name: 'Updated Name' });
  });

  it('returns 404 when updating non-existent user', async () => {
    mockGetUserById.mockResolvedValue(null as any);

    const response = await PUT(createMockRequest({ method: 'PUT', body: { name: 'X' } }), { params: Promise.resolve({ id: '999' }) });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('POST /api/v1/users password policy', () => {
  it.each(['x', 'alllowercase1!', 'NoDigitsHere!!', 'NoSpecial12345', 'Sh0rt!'])(
    'rejects a weak password (%s)',
    async (password) => {
      const response = await createPOST(
        createMockRequest({ method: 'POST', body: { email: 'new@example.com', password, role: 'admin' } })
      );
      expect(response.status).toBe(400);
      expect(vi.mocked(createUser)).not.toHaveBeenCalled();
    }
  );

  it('creates a user with a compliant password', async () => {
    vi.mocked(createUser).mockResolvedValue({ ...sampleUser, id: 2, email: 'new@example.com' } as any);
    const response = await createPOST(
      createMockRequest({ method: 'POST', body: { email: 'new@example.com', password: 'Compliant-Pass-2026' } })
    );
    expect(response.status).toBe(201);
    expect(await response.json()).not.toHaveProperty('passwordHash');
  });
});
