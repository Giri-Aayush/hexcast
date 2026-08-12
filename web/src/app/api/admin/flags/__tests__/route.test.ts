import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks (before route import) ---

vi.mock('@/lib/server-auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/admin', () => ({
  isAdmin: vi.fn(),
}));

const mockChains: any[] = [];
let chainIndex = 0;

function makeChain() {
  const chain: Record<string, any> = {};
  [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'is',
    'ilike', 'order', 'limit', 'range', 'single', 'maybeSingle',
    'onConflict', 'not', 'filter', 'match', 'or',
  ].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  const idx = chainIndex++;
  chain.single = vi.fn().mockResolvedValue(mockChains[idx] ?? { data: null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue(mockChains[idx] ?? { data: null, error: null });
  (chain as any).then = (resolve: any) =>
    resolve(mockChains[idx] ?? { data: null, error: null });
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn().mockImplementation(() => makeChain()), rpc: vi.fn() },
}));

import { GET, PATCH } from '../route';
import { isAdmin } from '@/lib/admin';

const mockIsAdmin = vi.mocked(isAdmin);

// --- Helpers ---

function req(url: string, opts?: { method?: string; body?: unknown }) {
  const { method = 'GET', body } = opts ?? {};
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'http://localhost:3000'), init as any);
}

const VALID_UUID = '00000000-0000-0000-0000-000000000001';

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  chainIndex = 0;
  mockChains.length = 0;
  mockIsAdmin.mockResolvedValue({ admin: false, userId: null });
});

describe('GET /api/admin/flags', () => {
  it('returns 403 when not admin', async () => {
    const res = await GET();
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns flags', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const flagsData = [
      { id: 'f1', card_id: 'c1', user_id: 'u1', reason: 'spam', reported_at: '2024-01-01', resolved: false, cards: {} },
    ];
    // Chain 0: from('flags').select(...).eq(...).order(...).limit(...)
    mockChains[0] = { data: flagsData, error: null };

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.flags).toEqual(flagsData);
  });
});

describe('PATCH /api/admin/flags', () => {
  it('returns 403 when not admin', async () => {
    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: 'f1', action: 'resolve' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid JSON', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const r = new NextRequest(
      new URL('http://localhost:3000/api/admin/flags'),
      {
        method: 'PATCH',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      },
    );

    const res = await PATCH(r);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Invalid JSON');
  });

  it('returns 400 when flag_id/action missing', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: 'f1' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('flag_id and action required');
  });

  it('resolves flag', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: update flag resolved
    mockChains[0] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: VALID_UUID, action: 'resolve' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('suspends card and resolves flag', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: get flag card_id — from('flags').select('card_id').eq(...).single()
    mockChains[0] = { data: { card_id: 'card-1' }, error: null };
    // Chain 1: update flag resolved
    mockChains[1] = { data: null, error: null };
    // Chain 2: update card is_suspended
    mockChains[2] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: VALID_UUID, action: 'suspend' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.suspended).toBe('card-1');
  });

  it('returns 404 when flag not found', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const missingUuid = '00000000-0000-0000-0000-000000000099';
    // Chain 0: get flag — not found
    mockChains[0] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: missingUuid, action: 'suspend' },
      }),
    );
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain('Flag not found');
  });

  it('returns 400 for invalid action', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: VALID_UUID, action: 'delete' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Invalid action');
  });

  it('returns 500 when DB error on resolve', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: update flag resolved — DB error
    mockChains[0] = { data: null, error: { message: 'DB update failed' } };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/flags', {
        method: 'PATCH',
        body: { flag_id: VALID_UUID, action: 'resolve' },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to resolve flag');
  });
});

describe('GET /api/admin/flags edge cases', () => {
  it('returns 500 when DB error occurs', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: from('flags').select(...) — DB error
    mockChains[0] = { data: null, error: { message: 'DB query failed' } };

    const res = await GET();
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to fetch flags');
  });
});
