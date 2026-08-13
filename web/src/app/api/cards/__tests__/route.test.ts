import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks (before route import) ---

vi.mock('@/lib/server-auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  getPersonalizedCards: vi.fn(),
}));

import { GET } from '../route';
import { auth } from '@/lib/server-auth';
import { getPersonalizedCards } from '@/lib/queries';

const mockAuth = vi.mocked(auth);
const mockGetPersonalizedCards = vi.mocked(getPersonalizedCards);

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
//
// The feed is gated: /api/cards serves the authenticated, personalized feed and
// nothing else. The anonymous branch (getCards) was removed, so a signed-out caller
// gets 401 — that's the API half of "nobody sees the feed without signing up".

beforeEach(() => {
  vi.clearAllMocks();
  // Default to authenticated; the 401 case sets userId: null explicitly.
  mockAuth.mockResolvedValue({ userId: 'user_123' } as any);
  mockGetPersonalizedCards.mockResolvedValue({ cards: [], unseenCount: 0 } as any);
});

describe('GET /api/cards', () => {
  it('returns 401 when not authenticated, without touching the DB', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);

    const res = await GET(req('http://localhost:3000/api/cards'));
    expect(res.status).toBe(401);
    expect(mockGetPersonalizedCards).not.toHaveBeenCalled();
  });

  it('returns personalized feed when authenticated', async () => {
    const cards = [{ id: '1', headline: 'test' }];
    mockGetPersonalizedCards.mockResolvedValue({ cards, unseenCount: 5 } as any);

    const res = await GET(req('http://localhost:3000/api/cards'));
    const json = await res.json();

    expect(mockGetPersonalizedCards).toHaveBeenCalledWith({
      userId: 'user_123',
      limit: 20,
      category: undefined,
      cursorSeen: undefined,
      cursorPublished: undefined,
    });
    expect(json.cards).toEqual(cards);
    expect(json.unseenCount).toBe(5);
  });

  it('clamps limit to max 50', async () => {
    await GET(req('http://localhost:3000/api/cards?limit=100'));

    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('passes category filter', async () => {
    await GET(req('http://localhost:3000/api/cards?category=defi'));

    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'defi' }),
    );
  });

  it('passes the composite cursor', async () => {
    await GET(
      req('http://localhost:3000/api/cards?cursor_seen=true&cursor_published=2024-01-01T00:00:00Z'),
    );

    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorSeen: true,
        cursorPublished: '2024-01-01T00:00:00Z',
      }),
    );
  });

  it('returns 500 on query error', async () => {
    mockGetPersonalizedCards.mockRejectedValue(new Error('DB failure'));

    const res = await GET(req('http://localhost:3000/api/cards'));
    expect(res.status).toBe(500);

    const json = await res.json();
    expect(json.error).toBe('Failed to fetch cards');
  });

  it('handles limit=abc (non-numeric) — NaN propagates through Math.min', async () => {
    await GET(req('http://localhost:3000/api/cards?limit=abc'));

    // Number('abc') = NaN, Math.min(NaN, 50) = NaN
    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({ limit: NaN }),
    );
  });

  it('handles limit=0 — returns empty cards', async () => {
    mockGetPersonalizedCards.mockResolvedValue({ cards: [], unseenCount: 0 } as any);

    const res = await GET(req('http://localhost:3000/api/cards?limit=0'));
    const json = await res.json();

    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 0 }),
    );
    expect(json.cards).toEqual([]);
  });

  it('handles limit=-5 — negative limit passes through Math.min', async () => {
    await GET(req('http://localhost:3000/api/cards?limit=-5'));

    // Math.min(-5, 50) = -5
    expect(mockGetPersonalizedCards).toHaveBeenCalledWith(
      expect.objectContaining({ limit: -5 }),
    );
  });

  it('hasMore is true when exactly limit cards returned', async () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ id: String(i), headline: `card ${i}` }));
    mockGetPersonalizedCards.mockResolvedValue({ cards, unseenCount: 0 } as any);

    const res = await GET(req('http://localhost:3000/api/cards'));
    const json = await res.json();

    // Default limit is 20, returned 20 cards → hasMore = true
    expect(json.hasMore).toBe(true);
  });

  it('hasMore is false when fewer than limit cards returned', async () => {
    const cards = [{ id: '1', headline: 'card 1' }];
    mockGetPersonalizedCards.mockResolvedValue({ cards, unseenCount: 0 } as any);

    const res = await GET(req('http://localhost:3000/api/cards'));
    const json = await res.json();

    // Default limit is 20, returned 1 card → hasMore = false
    expect(json.hasMore).toBe(false);
  });
});
