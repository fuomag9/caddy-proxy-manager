/**
 * /api/user/change-password: shared password policy, revocation of the
 * user's other sessions, and a recent sign-in before an OAuth-only account
 * can add its first password.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCurrentSessionInfo: vi.fn(),
  getUserById: vi.fn(),
  updateUserPassword: vi.fn(),
  revokeOtherUserSessions: vi.fn(),
  deleteUserForwardAuthSessions: vi.fn(),
  createAuditEvent: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  auth: mocks.auth,
  checkSameOrigin: () => null,
  getCurrentSessionInfo: mocks.getCurrentSessionInfo,
}));
vi.mock('@/src/lib/models/user', () => ({
  getUserById: mocks.getUserById,
  updateUserPassword: mocks.updateUserPassword,
}));
vi.mock('@/src/lib/models/sessions', () => ({ revokeOtherUserSessions: mocks.revokeOtherUserSessions }));
vi.mock('@/src/lib/models/forward-auth', () => ({ deleteUserForwardAuthSessions: mocks.deleteUserForwardAuthSessions }));
vi.mock('@/src/lib/models/audit', () => ({ createAuditEvent: mocks.createAuditEvent }));

import { POST } from '@/app/api/user/change-password/route';

const CURRENT = 'Current-Pass-2026!';
const NEXT = 'Brand-New-Pass-2026!';
let userCounter = 100;

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/user/change-password', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function signedInUser(passwordHash: string | null, sessionAgeMs: number) {
  // A fresh user id per test keeps the per-user rate-limit keys independent.
  const id = ++userCounter;
  mocks.auth.mockResolvedValue({ user: { id: String(id), role: 'user' } });
  mocks.getUserById.mockResolvedValue({ id, passwordHash });
  mocks.getCurrentSessionInfo.mockResolvedValue({ id: 55, createdAt: new Date(Date.now() - sessionAgeMs) });
  return id;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('change-password route', () => {
  it('rejects a password that does not meet the policy', async () => {
    signedInUser(bcrypt.hashSync(CURRENT, 4), 0);
    const res = await POST(request({ currentPassword: CURRENT, newPassword: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least 12 characters/);
    expect(mocks.updateUserPassword).not.toHaveBeenCalled();
  });

  it('revokes other management sessions and all forward-auth sessions after a change', async () => {
    const id = signedInUser(bcrypt.hashSync(CURRENT, 4), 24 * 60 * 60 * 1000);
    const res = await POST(request({ currentPassword: CURRENT, newPassword: NEXT }));
    expect(res.status).toBe(200);
    expect(mocks.updateUserPassword).toHaveBeenCalledWith(id, expect.any(String));
    expect(mocks.revokeOtherUserSessions).toHaveBeenCalledWith(id, 55);
    expect(mocks.deleteUserForwardAuthSessions).toHaveBeenCalledWith(id);
  });

  it('requires a recent sign-in before an account without a password can add one', async () => {
    signedInUser(null, 60 * 60 * 1000);
    const stale = await POST(request({ newPassword: NEXT }));
    expect(stale.status).toBe(403);
    expect(mocks.updateUserPassword).not.toHaveBeenCalled();

    signedInUser(null, 60 * 1000);
    const fresh = await POST(request({ newPassword: NEXT }));
    expect(fresh.status).toBe(200);
    expect(mocks.updateUserPassword).toHaveBeenCalled();
  });
});
