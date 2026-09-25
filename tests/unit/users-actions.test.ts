/**
 * Admin user Server Actions validate their client-supplied arguments.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createUser: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/src/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/src/lib/models/user', () => ({
  createUser: mocks.createUser,
  updateUserProfile: vi.fn(),
  updateUserRole: mocks.updateUserRole,
  updateUserStatus: mocks.updateUserStatus,
  deleteUser: vi.fn(),
}));

import { createUserAction, updateUserRoleAction, updateUserStatusAction } from '@/app/(dashboard)/users/actions';

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireAdmin.mockResolvedValue({ user: { id: '1', role: 'admin' } });
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('users actions', () => {
  it('rejects unknown roles and statuses', async () => {
    await expect(updateUserRoleAction(2, 'superuser' as never)).rejects.toThrow('Invalid role');
    await expect(updateUserStatusAction(2, 'pending')).rejects.toThrow('Invalid status');
    expect(mocks.updateUserRole).not.toHaveBeenCalled();
    expect(mocks.updateUserStatus).not.toHaveBeenCalled();
  });

  it('accepts known roles and statuses', async () => {
    await updateUserRoleAction(2, 'viewer');
    await updateUserStatusAction(2, 'disabled');
    expect(mocks.updateUserRole).toHaveBeenCalledWith(2, 'viewer');
    expect(mocks.updateUserStatus).toHaveBeenCalledWith(2, 'disabled');
  });

  it('refuses to create a user with a weak password', async () => {
    await expect(createUserAction(form({ email: 'a@localhost', password: 'password' }))).rejects.toThrow(/at least 12/);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});
