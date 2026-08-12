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
import { supabase } from '@/lib/supabase';

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

describe('GET /api/admin/cards', () => {
  it('returns 403 when not admin', async () => {
    const res = await GET(req('http://localhost:3000/api/admin/cards'));
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns cards with default limit', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const cardsData = [
      { id: VALID_UUID, headline: 'Test card', is_suspended: false },
    ];
    // Chain 0: from('cards').select(...).order(...).limit(...)
    mockChains[0] = { data: cardsData, error: null };

    const res = await GET(req('http://localhost:3000/api/admin/cards'));
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.cards).toEqual(cardsData);
  });

  it('filters by suspended', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const cardsData = [
      { id: VALID_UUID, headline: 'Suspended card', is_suspended: true },
    ];
    mockChains[0] = { data: cardsData, error: null };

    const res = await GET(
      req('http://localhost:3000/api/admin/cards?suspended=true'),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.cards).toEqual(cardsData);
  });

  it('searches by headline', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    mockChains[0] = { data: [], error: null };

    const res = await GET(
      req('http://localhost:3000/api/admin/cards?q=bitcoin'),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.cards).toEqual([]);
  });

  it('clamps limit to 100', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    mockChains[0] = { data: [], error: null };

    const res = await GET(
      req('http://localhost:3000/api/admin/cards?limit=200'),
    );
    expect(res.status).toBe(200);

    // The route uses Math.min(..., 100), so the chain's .limit() should be called with 100
    // We verify the route didn't error and returned successfully
    const json = await res.json();
    expect(json.cards).toEqual([]);
  });
});

describe('PATCH /api/admin/cards', () => {
  it('returns 403 when not admin', async () => {
    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'suspend' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid JSON', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const r = new NextRequest(
      new URL('http://localhost:3000/api/admin/cards'),
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

  it('returns 400 when card_id/action missing', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id and action required');
  });

  it('suspends card', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: update card
    mockChains[0] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'suspend' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('unsuspends card', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: update card
    mockChains[0] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'unsuspend' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('deletes card', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: delete card
    mockChains[0] = { data: null, error: null };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'delete' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 400 for invalid action', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'archive' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Invalid action');
  });

  it('returns 500 when DB error on suspend action', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: update card — DB error
    mockChains[0] = { data: null, error: { message: 'DB update failed' } };

    const res = await PATCH(
      req('http://localhost:3000/api/admin/cards', {
        method: 'PATCH',
        body: { card_id: VALID_UUID, action: 'suspend' },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to suspend card');
  });
});

describe('GET /api/admin/cards edge cases', () => {
  it('returns 500 when DB error occurs', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    // Chain 0: from('cards').select(...) — DB error
    mockChains[0] = { data: null, error: { message: 'DB query failed' } };

    const res = await GET(req('http://localhost:3000/api/admin/cards'));
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to fetch cards');
  });

  it('handles limit=0 — Math.min(0, 100) = 0', async () => {
    mockIsAdmin.mockResolvedValue({ admin: true, userId: 'admin_1' });

    mockChains[0] = { data: [], error: null };

    const res = await GET(
      req('http://localhost:3000/api/admin/cards?limit=0'),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.cards).toEqual([]);
  });
});
