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

import { POST } from '../route';
import { auth } from '@/lib/server-auth';

const mockAuth = vi.mocked(auth);

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
});

describe('POST /api/card-views', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [VALID_UUID] },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when card_ids not an array', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: 'not-an-array' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_ids');
  });

  it('returns 400 when card_ids empty', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [] },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('card_ids');
  });

  it('returns 400 when no valid UUIDs', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: ['not-uuid', 'also-not'] },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('No valid');
  });

  it('caps at 50 IDs', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Generate 60 valid UUIDs
    const ids = Array.from({ length: 60 }, (_, i) =>
      `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
    );

    // Chain 0: upsert
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: ids },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.recorded).toBe(50);
  });

  it('returns { recorded: N }', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: upsert
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [VALID_UUID, VALID_UUID_2] },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.recorded).toBe(2);
  });

  it('returns 400 for invalid JSON body', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const r = new NextRequest(
      new URL('http://localhost:3000/api/card-views'),
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

  it('returns 500 when DB error on upsert', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: upsert — DB error
    mockChains[0] = { data: null, error: { message: 'DB upsert failed' } };

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [VALID_UUID] },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to record views');
  });

  it('filters out non-string and invalid UUID entries from mixed types array', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: upsert
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [VALID_UUID, 123, null, 'invalid'] },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    // Only VALID_UUID passes the filter (typeof string && UUID_RE match)
    expect(json.recorded).toBe(1);
  });

  it('processes duplicate valid UUIDs (dedup is on DB side via upsert)', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: upsert
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/card-views', {
        method: 'POST',
        body: { card_ids: [VALID_UUID, VALID_UUID] },
      }),
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    // Both pass the filter, dedup happens on DB side via ignoreDuplicates
    expect(json.recorded).toBe(2);
  });
});
