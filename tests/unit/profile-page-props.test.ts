/**
 * The profile page must hand the client component only what it renders:
 * whether a password is set, never the bcrypt hash itself, and the username
 * the login page accepts (which also decides whether OAuth can be unlinked)
 * or, without one, why the login page cannot use the password.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const HASH = '$2a$12$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';
const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  getUserPasswordHash: vi.fn(),
  getPasswordSignInStatus: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  requireUser: vi.fn().mockResolvedValue({ user: { id: '7', role: 'user' } }),
  getCurrentSessionId: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/models/user', () => ({
  getUserById: mocks.getUserById,
  getUserPasswordHash: mocks.getUserPasswordHash,
  getPasswordSignInStatus: mocks.getPasswordSignInStatus,
  listUserOAuthProviders: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/lib/models/oauth-providers', () => ({ getProviderDisplayList: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/models/api-tokens', () => ({ listApiTokens: vi.fn().mockResolvedValue([]) }));
vi.mock('@/src/lib/models/sessions', () => ({ listUserSessions: vi.fn().mockResolvedValue([]) }));
vi.mock('@/app/(dashboard)/profile/ProfileClient', () => ({ default: () => null }));

import ProfilePage from '@/app/(dashboard)/profile/page';

function user(passwordHash: string | null) {
  return {
    id: 7,
    email: 'alice@example.com',
    name: 'Alice',
    passwordHash,
    role: 'user',
    provider: 'credentials',
    subject: 'alice',
    avatarUrl: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

async function renderProps() {
  return ((await ProfilePage()) as { props: { user: Record<string, unknown> } }).props;
}

beforeEach(() => {
  mocks.getUserById.mockReset();
  mocks.getUserPasswordHash.mockReset();
  mocks.getPasswordSignInStatus.mockReset().mockResolvedValue({ username: null, blocker: 'no-credential' });
});

describe('profile page props', () => {
  it('passes hasPassword and no password hash to the client component', async () => {
    mocks.getUserById.mockResolvedValue(user(HASH));
    mocks.getUserPasswordHash.mockResolvedValue(HASH);
    const props = await renderProps();
    expect(props.user.hasPassword).toBe(true);
    expect(props.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(props)).not.toContain('$2a$');
  });

  it('counts a password stored only on the credential account', async () => {
    mocks.getUserById.mockResolvedValue(user(null));
    mocks.getUserPasswordHash.mockResolvedValue(HASH);
    const props = await renderProps();
    expect(props.user.hasPassword).toBe(true);
    expect(JSON.stringify(props)).not.toContain('$2a$');
  });

  it('reports no password for an OAuth-only account', async () => {
    mocks.getUserById.mockResolvedValue(user(null));
    mocks.getUserPasswordHash.mockResolvedValue(null);
    const props = await renderProps();
    expect(props.user.hasPassword).toBe(false);
    expect(props.user.signInUsername).toBeNull();
    expect(props.user.passwordSignInBlocker).toBe('no-credential');
  });

  it('passes the login-page username from the same check unlink-oauth makes', async () => {
    mocks.getUserById.mockResolvedValue(user(HASH));
    mocks.getUserPasswordHash.mockResolvedValue(HASH);
    mocks.getPasswordSignInStatus.mockResolvedValue({ username: 'alice@example.com', blocker: null });
    const props = await renderProps();
    expect(mocks.getPasswordSignInStatus).toHaveBeenCalledWith(7);
    expect(props.user.signInUsername).toBe('alice@example.com');
    expect(props.user.passwordSignInBlocker).toBeNull();
  });

  it.each(['no-credential', 'no-username'] as const)(
    'keeps unlinking off and passes the reason for a password the login page cannot use (%s)',
    async (blocker) => {
      mocks.getUserById.mockResolvedValue(user(HASH));
      mocks.getUserPasswordHash.mockResolvedValue(HASH);
      mocks.getPasswordSignInStatus.mockResolvedValue({ username: null, blocker });
      const props = await renderProps();
      expect(props.user.hasPassword).toBe(true);
      expect(props.user.signInUsername).toBeNull();
      expect(props.user.passwordSignInBlocker).toBe(blocker);
    }
  );
});
