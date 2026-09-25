/**
 * The profile page must hand the client component only what it renders:
 * whether a password is set, never the bcrypt hash itself.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/auth', () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: '7', role: 'user' } }),
  getCurrentSessionId: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/models/user', () => ({
  getUserById: vi.fn().mockResolvedValue({
    id: 7,
    email: 'alice@localhost',
    name: 'Alice',
    passwordHash: '$2a$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012',
    role: 'user',
    provider: 'credentials',
    subject: 'alice',
    avatarUrl: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }),
  listUserOAuthProviders: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/lib/models/oauth-providers', () => ({ getProviderDisplayList: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/models/api-tokens', () => ({ listApiTokens: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/models/sessions', () => ({ listUserSessions: vi.fn().mockResolvedValue([]) }));
vi.mock('@/app/(dashboard)/profile/ProfileClient', () => ({ default: () => null }));

import ProfilePage from '@/app/(dashboard)/profile/page';

describe('profile page props', () => {
  it('passes hasPassword and no password hash to the client component', async () => {
    const element = (await ProfilePage()) as { props: { user: Record<string, unknown> } };
    expect(element.props.user.hasPassword).toBe(true);
    expect(element.props.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(element.props)).not.toContain('$2a$');
  });
});
