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

import { POST } from '../route';
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

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
  chainIndex = 0;
  mockChains.length = 0;
  mockAuth.mockResolvedValue({ userId: null } as any);
  mockCheckUserRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
});

describe('POST /api/feedback', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'Great app!' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate limited', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);
    mockCheckUserRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'Great app!' },
      }),
    );
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const r = new NextRequest(
      new URL('http://localhost:3000/api/feedback'),
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

  it('returns 400 when message missing', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: {},
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('message');
  });

  it('returns 400 when message > 500 chars', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'x'.repeat(501) },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('500');
  });

  it('returns 201 on success', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: insert feedback
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'Great app!' },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 201 with page_url', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: insert feedback
    mockChains[0] = { data: null, error: null };

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'Bug on this page', page_url: '/dashboard' },
      }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('returns 400 when message is whitespace only', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: '   ' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('message');
  });

  it('returns 400 when message is newlines only', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: '\n\n\n' },
      }),
    );
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.error).toContain('message');
  });

  it('returns 500 when DB error during insert', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' } as any);

    // Chain 0: insert feedback — DB error
    mockChains[0] = { data: null, error: { message: 'DB insert failed' } };

    const res = await POST(
      req('http://localhost:3000/api/feedback', {
        method: 'POST',
        body: { message: 'Great app!' },
      }),
    );
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toContain('Failed to submit feedback');
  });
});
