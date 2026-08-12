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

import { POST } from '../route';
import { auth } from '@/lib/server-auth';
import { checkUserRateLimit } from '@/lib/rate-limit';
import { supabase } from '@/lib/supabase';

const mockAuth = vi.mocked(auth);
const mockCheckUserRateLimit = vi.mocked(checkUserRateLimit);
const mockFrom = vi.mocked(supabase.from);

/** The chain object returned by the Nth supabase.from() call in this request. */
function chainFor(call: number) {
  return mockFrom.mock.results[call]?.value;
}

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

describe('POST /api/flags', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await POST(
      req('http://localhost:3000/api/flags', {
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
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const r = new NextRequest(
      new URL('http://localhost:3000/api/flags'),
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
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { reason: 'spam' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });

  it('returns 400 when reason > 500 chars', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID, reason: 'x'.repeat(501) },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('500');
  });

  it('returns 409 when already flagged', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — found
    mockChains[0] = { data: { id: 'flag-1' }, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(409);

    const json = await res.json();
    expect(json.error).toContain('Already flagged');
  });

  it('returns 404 when card not found', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — not found
    mockChains[1] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(404);

    const json = await res.json();
    expect(json.error).toContain('Card not found');
  });

  it('returns 201 on success with reason', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — found
    mockChains[1] = { data: { id: VALID_UUID, flag_count: 2 }, error: null };
    // Chain 2: insert flag
    mockChains[2] = { data: null, error: null };
    // Chain 3: update card flag_count
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID, reason: 'spam content' },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 201 on success without reason', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — found
    mockChains[1] = { data: { id: VALID_UUID, flag_count: 0 }, error: null };
    // Chain 2: insert flag
    mockChains[2] = { data: null, error: null };
    // Chain 3: update card flag_count
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('accepts empty string reason (valid string with length <= 500)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — found
    mockChains[1] = { data: { id: VALID_UUID, flag_count: 1 }, error: null };
    // Chain 2: insert flag
    mockChains[2] = { data: null, error: null };
    // Chain 3: update card flag_count
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID, reason: '' },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('accepts whitespace-only reason (valid string with length <= 500)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — found
    mockChains[1] = { data: { id: VALID_UUID, flag_count: 0 }, error: null };
    // Chain 2: insert flag
    mockChains[2] = { data: null, error: null };
    // Chain 3: update card flag_count
    mockChains[3] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID, reason: '   ' },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 500 when DB error on flag insert', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: check existing flag — not found
    mockChains[0] = { data: null, error: null };
    // Chain 1: check card exists — found
    mockChains[1] = { data: { id: VALID_UUID, flag_count: 0 }, error: null };
    // Chain 2: insert flag — DB error
    mockChains[2] = { data: null, error: { message: 'DB insert failed' } };

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to submit flag');
  });

  it('returns 400 when card_id is a number instead of string', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: 123 },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_id');
  });
});

/**
 * Chain order for a successful flag:
 *   0 flags  — has this person already flagged it
 *   1 cards  — does the card exist, is it already suspended
 *   2 flags  — the insert
 *   3 flags  — headcount for the suspension check
 *   4 cards  — the suspension, only when the threshold is met
 */
describe('auto-suspension', () => {
  function setup({ count, isSuspended = false }: { count: number; isSuspended?: boolean }) {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);
    mockChains[0] = { data: null, error: null };
    mockChains[1] = { data: { id: VALID_UUID, is_suspended: isSuspended }, error: null };
    mockChains[2] = { data: null, error: null };
    mockChains[3] = { count, error: null };
  }

  const flag = () =>
    POST(
      req('http://localhost:3000/api/flags', {
        method: 'POST',
        body: { card_id: VALID_UUID, reason: 'Inaccurate information' },
      }),
    );

  it('suspends the card once enough different people have flagged it', async () => {
    setup({ count: 3 });

    const res = await flag();

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, suspended: true });
    expect(chainFor(4).update).toHaveBeenCalledWith({ is_suspended: true });
  });

  it('keeps serving the card below the threshold', async () => {
    setup({ count: 2 });

    const res = await flag();

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true });
    // Only four calls: no suspension write.
    expect(mockFrom).toHaveBeenCalledTimes(4);
  });

  it('never writes flag_count itself — the 003 trigger owns it', async () => {
    setup({ count: 1 });

    await flag();

    // A manual increment here double-counted every flag and raced two concurrent
    // flags into one. If this starts failing, that bug is back.
    for (let i = 0; i < mockFrom.mock.results.length; i++) {
      const calls = chainFor(i).update.mock.calls;
      for (const [payload] of calls) {
        expect(payload).not.toHaveProperty('flag_count');
      }
    }
  });

  it('records the flag but does not re-suspend an already suspended card', async () => {
    setup({ count: 9, isSuspended: true });

    const res = await flag();

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, suspended: true });
    // Insert happened, headcount and suspension were skipped.
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });

  it('still records the flag when the headcount query fails', async () => {
    setup({ count: 0 });
    mockChains[3] = { count: null, error: { message: 'count failed' } };

    const res = await flag();

    // The flag is safely stored; only the suspension decision was inconclusive.
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true });
  });

  it('treats a unique violation as an already-flagged conflict, not a 500', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);
    mockChains[0] = { data: null, error: null };
    mockChains[1] = { data: { id: VALID_UUID, is_suspended: false }, error: null };
    // Two concurrent flags from one person: the pre-check missed it, the
    // UNIQUE (card_id, user_id) from migration 018 caught it.
    mockChains[2] = { data: null, error: { code: '23505', message: 'duplicate key' } };

    const res = await flag();

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Already flagged');
  });
});
