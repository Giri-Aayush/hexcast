import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks (before route import) ---

vi.mock('@/lib/server-auth', () => ({
  auth: vi.fn(),
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 299 }),
  checkUserRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 29 }),
}));

import { GET, POST } from '../route';
import { auth } from '@/lib/server-auth';
import { checkUserRateLimit } from '@/lib/rate-limit';

const mockAuth = vi.mocked(auth);
const mockCheckUserRateLimit = vi.mocked(checkUserRateLimit);

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
  mockAuth.mockResolvedValue({ userId: null } as any);
  mockCheckUserRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
});

describe('GET /api/saved', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await GET();
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns saved cards', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const savedData = [
      { card_id: VALID_UUID, saved_at: '2024-01-01', cards: { id: VALID_UUID, headline: 'test' } },
    ];
    // Chain 0: from('saved_cards').select(...).eq(...).order(...)
    mockChains[0] = { data: savedData, error: null };

    const res = await GET();
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.saved).toEqual(savedData);
  });
});

describe('POST /api/saved', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);
    mockCheckUserRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const r = new NextRequest(
      new URL('http://localhost:3000/api/saved'),
      {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      },
    );

    const res = await POST(r);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Invalid JSON');
  });

  it('returns 400 for invalid card_id', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: 'not-a-uuid' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });

  it('unsaves when already saved (returns { saved: false })', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — found
    mockChains[0] = { data: { card_id: VALID_UUID }, error: null };
    // Chain 1: delete
    mockChains[1] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.saved).toBe(false);
  });

  it('saves when not saved (returns { saved: true })', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: insert
    mockChains[1] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.saved).toBe(true);
  });

  it('returns 500 when DB error on insert (save fails)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: insert — DB error
    mockChains[1] = { data: null, error: { message: 'DB insert failed' } };

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to save card');
  });

  it('returns 400 when card_id is a number instead of string', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/saved', {
        method: 'POST',
        body: { card_id: 123 },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });
});

describe('GET /api/saved edge cases', () => {
  it('returns 500 when DB error occurs', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: from('saved_cards').select(...).eq(...).order(...) — DB error
    mockChains[0] = { data: null, error: { message: 'DB failure' } };

    const res = await GET();
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to fetch saved cards');
  });
});
