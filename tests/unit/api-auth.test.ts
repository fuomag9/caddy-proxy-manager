import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api-tokens model
vi.mock('@/src/lib/models/api-tokens', () => ({
  validateToken: vi.fn(),
}));

// Mock next-auth
vi.mock('@/src/lib/auth', () => ({
  auth: vi.fn(),
  checkSameOrigin: vi.fn(() => null),
}));

import { authenticateApiRequest, requireApiUser, requireApiAdmin, ApiAuthError } from '@/src/lib/api-auth';
import { validateToken } from '@/src/lib/models/api-tokens';
import { auth } from '@/src/lib/auth';

const mockValidateToken = vi.mocked(validateToken);
const mockAuth = vi.mocked(auth);

function createMockRequest(options: { authorization?: string; method?: string; origin?: string } = {}): any {
  return {
    headers: {
      get(name: string) {
        if (name === 'authorization') return options.authorization ?? null;
        if (name === 'origin') return options.origin ?? null;
        return null;
      },
    },
    method: options.method ?? 'GET',
    nextUrl: { pathname: '/api/v1/test' },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('authenticateApiRequest', () => {
  it('authenticates via Bearer token', async () => {
    mockValidateToken.mockResolvedValue({
      token: { id: 1, name: 'test', created_by: 42, created_at: '', last_used_at: null, expires_at: null },
      user: { id: 42, role: 'admin' },
    });

    const result = await authenticateApiRequest(createMockRequest({ authorization: 'Bearer test-token' }));

    expect(result.userId).toBe(42);
    expect(result.role).toBe('admin');
    expect(result.authMethod).toBe('bearer');
    expect(mockValidateToken).toHaveBeenCalledWith('test-token');
  });

  it('rejects invalid Bearer token', async () => {
    mockValidateToken.mockResolvedValue(null);

    await expect(
      authenticateApiRequest(createMockRequest({ authorization: 'Bearer bad-token' }))
    ).rejects.toThrow(ApiAuthError);
  });

  it('falls back to session auth when no Bearer header', async () => {
    mockAuth.mockResolvedValue({
      user: { id: '10', role: 'user', name: 'Test', email: 'test@test.com' },
      expires: '',
    } as any);

    const result = await authenticateApiRequest(createMockRequest());

    expect(result.userId).toBe(10);
    expect(result.role).toBe('user');
    expect(result.authMethod).toBe('session');
  });

  it('throws 401 when neither auth method succeeds', async () => {
    mockAuth.mockResolvedValue(null as any);

    await expect(
      authenticateApiRequest(createMockRequest())
    ).rejects.toThrow(ApiAuthError);

    try {
      await authenticateApiRequest(createMockRequest());
    } catch (e) {
      expect((e as ApiAuthError).status).toBe(401);
    }
  });
});

describe('requireApiAdmin', () => {
  it('allows admin users', async () => {
    mockValidateToken.mockResolvedValue({
      token: { id: 1, name: 'test', created_by: 1, created_at: '', last_used_at: null, expires_at: null },
      user: { id: 1, role: 'admin' },
    });

    const result = await requireApiAdmin(createMockRequest({ authorization: 'Bearer token' }));
    expect(result.role).toBe('admin');
  });

  it('rejects non-admin users with 403', async () => {
    mockValidateToken.mockResolvedValue({
      token: { id: 1, name: 'test', created_by: 2, created_at: '', last_used_at: null, expires_at: null },
      user: { id: 2, role: 'user' },
    });

    try {
      await requireApiAdmin(createMockRequest({ authorization: 'Bearer token' }));
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiAuthError);
      expect((e as ApiAuthError).status).toBe(403);
    }
  });
});

describe('requireApiUser', () => {
  it('returns auth result for valid user', async () => {
    mockAuth.mockResolvedValue({
      user: { id: '5', role: 'viewer', name: 'V', email: 'v@test.com' },
      expires: '',
    } as any);

    const result = await requireApiUser(createMockRequest());
    expect(result.userId).toBe(5);
    expect(result.role).toBe('viewer');
  });
});
