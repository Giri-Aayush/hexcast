import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server-auth', () => ({
  auth: vi.fn(),
}));

import { isAdmin } from '../admin';
import { auth } from '@/lib/server-auth';

const mockAuth = vi.mocked(auth);

describe('isAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns admin:true for user_admin_123', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_admin_123' } as any);
    const result = await isAdmin();
    expect(result).toEqual({ admin: true, userId: 'user_admin_123' });
  });

  it('returns admin:true for user_admin_456', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_admin_456' } as any);
    const result = await isAdmin();
    expect(result).toEqual({ admin: true, userId: 'user_admin_456' });
  });

  it('returns admin:false for an unknown user', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_unknown_789' } as any);
    const result = await isAdmin();
    expect(result).toEqual({ admin: false, userId: 'user_unknown_789' });
  });

  it('returns admin:false and userId:null when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);
    const result = await isAdmin();
    expect(result).toEqual({ admin: false, userId: null });
  });

  it('handles multiple admin IDs from comma-separated env', async () => {
    // Both IDs from ADMIN_USER_IDS='user_admin_123,user_admin_456' should work
    mockAuth.mockResolvedValue({ userId: 'user_admin_123' } as any);
    expect(await isAdmin()).toEqual({ admin: true, userId: 'user_admin_123' });

    mockAuth.mockResolvedValue({ userId: 'user_admin_456' } as any);
    expect(await isAdmin()).toEqual({ admin: true, userId: 'user_admin_456' });

    // And a non-admin should still be rejected
    mockAuth.mockResolvedValue({ userId: 'user_regular' } as any);
    expect(await isAdmin()).toEqual({ admin: false, userId: 'user_regular' });
  });
});
