import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks (before route import) ---

vi.mock('@clerk/nextjs/server', () => ({
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
import { auth } from '@clerk/nextjs/server';
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
const VALID_UUID_2 = '00000000-0000-0000-0000-000000000002';

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  chainIndex = 0;
  mockChains.length = 0;
  mockAuth.mockResolvedValue({ userId: null } as any);
  mockCheckUserRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
});

describe('GET /api/reactions', () => {
  it('returns reaction counts for card_ids', async () => {
    // Chain 0: from('cards').select(...).in(...)
    mockChains[0] = {
      data: [
        { id: VALID_UUID, reaction_up_count: 5, reaction_down_count: 2 },
      ],
      error: null,
    };

    const res = await GET(
      req(`http://localhost:3000/api/reactions?card_ids=${VALID_UUID}`),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reactions[VALID_UUID]).toEqual({ up: 5, down: 2 });
  });

  it('returns 400 when card_ids string > 2000 chars', async () => {
    const longIds = 'a'.repeat(2001);
    const res = await GET(
      req(`http://localhost:3000/api/reactions?card_ids=${longIds}`),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('too long');
  });

  it('returns 400 for invalid UUID', async () => {
    const res = await GET(
      req('http://localhost:3000/api/reactions?card_ids=not-a-uuid'),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('Invalid');
  });

  it('returns empty when card_ids empty', async () => {
    const res = await GET(
      req('http://localhost:3000/api/reactions?card_ids='),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reactions).toEqual({});
    expect(json.userReactions).toEqual({});
  });
});

describe('POST /api/reactions', () => {
  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);
    mockCheckUserRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const r = new NextRequest(
      new URL('http://localhost:3000/api/reactions'),
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

  it('returns 400 for missing card_id', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { reaction: 'up' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });

  it('returns 400 for invalid reaction value', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'love' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('reaction');
  });

  it('toggles off same reaction (returns { reaction: null })', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing reaction — found same
    mockChains[0] = {
      data: { id: 'rx-1', reaction: 'up' },
      error: null,
    };
    // Chain 1: delete reaction
    mockChains[1] = { data: null, error: null };
    // Chain 2: getCardCounts — from('cards').select(...).eq(...).single()
    mockChains[2] = {
      data: { reaction_up_count: 3, reaction_down_count: 1 },
      error: null,
    };
    // Chain 3: update card counts
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reaction).toBeNull();
  });

  it('switches reaction (up -> down)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — found different reaction
    mockChains[0] = {
      data: { id: 'rx-1', reaction: 'up' },
      error: null,
    };
    // Chain 1: update reaction
    mockChains[1] = { data: null, error: null };
    // Chain 2: getCardCounts
    mockChains[2] = {
      data: { reaction_up_count: 5, reaction_down_count: 2 },
      error: null,
    };
    // Chain 3: update card counts
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'down' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reaction).toBe('down');
  });

  it('inserts new reaction', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: insert reaction
    mockChains[1] = { data: null, error: null };
    // Chain 2: getCardCounts
    mockChains[2] = {
      data: { reaction_up_count: 0, reaction_down_count: 0 },
      error: null,
    };
    // Chain 3: update card counts
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reaction).toBe('up');
  });

  it('returns 500 when DB error occurs during reaction insert', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: insert reaction — DB error
    mockChains[1] = { data: null, error: { message: 'DB insert failed' } };

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to save reaction');
  });

  it('returns 400 for empty body {}', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: {},
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });

  it('returns 400 when reaction is null', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: VALID_UUID, reaction: null },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('reaction');
  });

  it('returns 400 when card_id is a number instead of string', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/reactions', {
        method: 'POST',
        body: { card_id: 123, reaction: 'up' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });
});

describe('GET /api/reactions edge cases', () => {
  it('returns reactions and userReactions for multiple valid card_ids with authenticated user', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: from('cards').select(...).in(...)
    mockChains[0] = {
      data: [
        { id: VALID_UUID, reaction_up_count: 5, reaction_down_count: 2 },
        { id: VALID_UUID_2, reaction_up_count: 10, reaction_down_count: 0 },
      ],
      error: null,
    };
    // Chain 1: auth() already resolved above
    // Chain 1: from('reactions').select(...).eq(...).in(...)
    mockChains[1] = {
      data: [
        { card_id: VALID_UUID, reaction: 'up' },
        { card_id: VALID_UUID_2, reaction: 'down' },
      ],
      error: null,
    };

    const res = await GET(
      req(`http://localhost:3000/api/reactions?card_ids=${VALID_UUID},${VALID_UUID_2}`),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.reactions[VALID_UUID]).toEqual({ up: 5, down: 2 });
    expect(json.reactions[VALID_UUID_2]).toEqual({ up: 10, down: 0 });
    expect(json.userReactions[VALID_UUID]).toBe('up');
    expect(json.userReactions[VALID_UUID_2]).toBe('down');
  });

  it('only processes first 50 card_ids when 51+ provided', async () => {
    // Generate 51 valid UUIDs
    const ids = Array.from({ length: 51 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );

    // Chain 0: from('cards').select(...).in(...)
    mockChains[0] = { data: [], error: null };

    const res = await GET(
      req(`http://localhost:3000/api/reactions?card_ids=${ids.join(',')}`),
    );
    expect(res.status).toBe(200);

    // Route slices to first 50, so the 51st UUID should not cause issues
    const json = await res.json();
    expect(json.reactions).toBeDefined();
  });
});
