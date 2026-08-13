import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Card } from '@hexcast/shared';

// --- Fluent chain mock, same pattern as queries.test.ts ---

const { mockSupabase, mockResult } = vi.hoisted(() => {
  const mockResult = { data: null as any, error: null as any };

  const chain: any = {};
  const methods = ['from', 'select', 'eq'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: any) => any) => resolve(mockResult);

  const mockSupabase = { from: chain.from };

  return { mockSupabase, mockResult, chain };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

import { computeAffinity, rankByAffinity, scoreCard } from '../affinity';
import type { PersonalizedCard } from '../queries';

// --- Helpers ---

function makeCard(
  category: string,
  id: string,
  publishedAt: string,
  overrides?: Partial<PersonalizedCard>,
): PersonalizedCard {
  return {
    id,
    source_id: overrides?.source_id ?? 'test-source',
    canonical_url: 'https://example.com',
    url_hash: 'abc',
    headline: 'Test',
    summary: 'Test summary',
    category,
    author: null,
    engagement: null,
    published_at: publishedAt,
    fetched_at: publishedAt,
    is_suspended: false,
    flag_count: 0,
    reaction_up_count: 0,
    reaction_down_count: 0,
    pipeline_version: '1.0.0',
    seen: false,
    ...overrides,
  } as PersonalizedCard;
}

function reactionRow(reaction: 'up' | 'down', category: string, sourceId = 'test-source') {
  return { reaction, cards: { category, source_id: sourceId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResult.data = null;
  mockResult.error = null;
});

// ===================================================================
// computeAffinity
// ===================================================================

describe('computeAffinity', () => {
  it('returns empty maps when the user has no reactions', async () => {
    mockResult.data = [];

    const affinity = await computeAffinity('user_new');

    expect(affinity.category.size).toBe(0);
    expect(affinity.source.size).toBe(0);
  });

  it('returns empty maps when data is null', async () => {
    mockResult.data = null;

    const affinity = await computeAffinity('user_new');

    expect(affinity.category.size).toBe(0);
    expect(affinity.source.size).toBe(0);
  });

  it('computes a positive category score from upvotes', async () => {
    mockResult.data = [
      reactionRow('up', 'SECURITY'),
      reactionRow('up', 'SECURITY'),
    ];

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.get('SECURITY')).toBeGreaterThan(0);
    expect(affinity.category.get('SECURITY')).toBeLessThan(1);
  });

  it('computes a negative category score from downvotes', async () => {
    mockResult.data = [
      reactionRow('down', 'GOVERNANCE'),
      reactionRow('down', 'GOVERNANCE'),
      reactionRow('down', 'GOVERNANCE'),
    ];

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.get('GOVERNANCE')).toBeLessThan(0);
  });

  it('nets opposing reactions to the same category', async () => {
    mockResult.data = [
      reactionRow('up', 'RESEARCH'),
      reactionRow('down', 'RESEARCH'),
    ];

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.get('RESEARCH')).toBe(0);
  });

  it('tracks source affinity independently of category affinity', async () => {
    mockResult.data = [reactionRow('up', 'SECURITY', 'rekt_news')];

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.get('SECURITY')).toBeGreaterThan(0);
    expect(affinity.source.get('rekt_news')).toBeGreaterThan(0);
  });

  it('does not let a heavy reactor blow past the [-1, 1] squash', async () => {
    // tanh saturates rather than growing unbounded — 20 net upvotes is well
    // past the point a handful of reactions would swing the score, but the
    // squash keeps it under 1, not blown out to some huge raw net.
    mockResult.data = Array.from({ length: 20 }, () => reactionRow('up', 'SECURITY'));

    const affinity = await computeAffinity('user_heavy');

    expect(affinity.category.get('SECURITY')).toBeLessThan(1);
    expect(affinity.category.get('SECURITY')!).toBeGreaterThan(0.9);
  });

  it('skips rows whose joined card is missing rather than crashing', async () => {
    mockResult.data = [{ reaction: 'up', cards: null }, reactionRow('up', 'SECURITY')];

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.get('SECURITY')).toBeGreaterThan(0);
    expect(affinity.category.size).toBe(1);
  });

  it('degrades to empty maps on a DB error rather than throwing', async () => {
    mockResult.error = { message: 'connection refused' };

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.size).toBe(0);
    expect(affinity.source.size).toBe(0);
  });

  it('degrades to empty maps if the query throws', async () => {
    mockSupabase.from.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const affinity = await computeAffinity('user_1');

    expect(affinity.category.size).toBe(0);
    expect(affinity.source.size).toBe(0);
  });
});

// ===================================================================
// scoreCard
// ===================================================================

describe('scoreCard', () => {
  it('is 0 for a card with no affinity signal', () => {
    const card = makeCard('SECURITY', 'c1', '2026-08-10T00:00:00Z');
    const score = scoreCard(card, { category: new Map(), source: new Map() });
    expect(score).toBe(0);
  });

  it('is positive for a liked category', () => {
    const card = makeCard('SECURITY', 'c1', '2026-08-10T00:00:00Z');
    const affinity = { category: new Map([['SECURITY', 0.5]]), source: new Map() };
    expect(scoreCard(card, affinity)).toBeGreaterThan(0);
  });

  it('is negative for a disliked category', () => {
    const card = makeCard('GOVERNANCE', 'c1', '2026-08-10T00:00:00Z');
    const affinity = { category: new Map([['GOVERNANCE', -0.5]]), source: new Map() };
    expect(scoreCard(card, affinity)).toBeLessThan(0);
  });
});

// ===================================================================
// rankByAffinity — the freshness guarantee
// ===================================================================

describe('rankByAffinity', () => {
  it('is a no-op for zero reactions (empty affinity) — identical order to unweighted', () => {
    const cards = [
      makeCard('RESEARCH', 'r1', '2026-08-11T10:00:00Z'),
      makeCard('SECURITY', 's1', '2026-08-11T09:00:00Z'),
      makeCard('GOVERNANCE', 'g1', '2026-08-10T10:00:00Z'),
      makeCard('SECURITY', 's2', '2026-08-10T09:00:00Z'),
    ];
    const emptyAffinity = { category: new Map(), source: new Map() };

    const result = rankByAffinity(cards, emptyAffinity);

    expect(result.map((c) => c.id)).toEqual(['r1', 's1', 'g1', 's2']);
  });

  it('does not mutate or crash on an empty candidate list', () => {
    const result = rankByAffinity([], { category: new Map([['SECURITY', 1]]), source: new Map() });
    expect(result).toEqual([]);
  });

  it('does not crash on a single-card list', () => {
    const cards = [makeCard('SECURITY', 's1', '2026-08-11T10:00:00Z')];
    const result = rankByAffinity(cards, { category: new Map([['SECURITY', 1]]), source: new Map() });
    expect(result).toEqual(cards);
  });

  it('reorders SECURITY earlier within the same recency bucket for an upvoter', () => {
    // All same calendar day — a pure within-bucket reorder.
    const cards = [
      makeCard('RESEARCH', 'r1', '2026-08-11T12:00:00Z'),
      makeCard('GOVERNANCE', 'g1', '2026-08-11T11:00:00Z'),
      makeCard('SECURITY', 's1', '2026-08-11T09:00:00Z'), // oldest of the day, but liked
    ];
    const affinity = { category: new Map([['SECURITY', 0.8]]), source: new Map() };

    const result = rankByAffinity(cards, affinity);

    // SECURITY, despite being the oldest card of the day, moves to the front
    // of its bucket because it's the only one with a positive score.
    expect(result[0].id).toBe('s1');
  });

  it('never lets a liked-but-stale card outrank a fresher card from a newer bucket', () => {
    const cards = [
      // Newer bucket (today), no affinity signal.
      makeCard('RESEARCH', 'fresh', '2026-08-11T08:00:00Z'),
      // Older bucket (3 days ago), the user's favorite category.
      makeCard('SECURITY', 'stale-liked', '2026-08-08T08:00:00Z'),
    ];
    const affinity = { category: new Map([['SECURITY', 1]]), source: new Map() };

    const result = rankByAffinity(cards, affinity);

    // The bucket boundary is checked before affinity, so freshness wins outright.
    expect(result[0].id).toBe('fresh');
    expect(result[1].id).toBe('stale-liked');
  });

  it('sinks a downvoted category to the back within its bucket', () => {
    const cards = [
      makeCard('GOVERNANCE', 'g1', '2026-08-11T12:00:00Z'),
      makeCard('RESEARCH', 'r1', '2026-08-11T11:00:00Z'),
      makeCard('SECURITY', 's1', '2026-08-11T10:00:00Z'),
    ];
    const affinity = { category: new Map([['GOVERNANCE', -0.9]]), source: new Map() };

    const result = rankByAffinity(cards, affinity);

    expect(result[result.length - 1].id).toBe('g1');
  });

  it('keeps buckets ordered newest-first even when affinity reorders within each', () => {
    const cards = [
      makeCard('RESEARCH', 'today-1', '2026-08-11T12:00:00Z'),
      makeCard('SECURITY', 'today-2', '2026-08-11T08:00:00Z'), // liked, oldest today
      makeCard('SECURITY', 'yesterday-1', '2026-08-10T12:00:00Z'), // liked, but yesterday
      makeCard('RESEARCH', 'yesterday-2', '2026-08-10T08:00:00Z'),
    ];
    const affinity = { category: new Map([['SECURITY', 1]]), source: new Map() };

    const result = rankByAffinity(cards, affinity);

    // All of today's cards precede all of yesterday's, regardless of affinity.
    const todayIds = new Set(['today-1', 'today-2']);
    const firstYesterdayIndex = result.findIndex((c) => !todayIds.has(c.id));
    for (let i = 0; i < firstYesterdayIndex; i++) {
      expect(todayIds.has(result[i].id)).toBe(true);
    }
    // Within today's bucket, the liked SECURITY card leads.
    expect(result[0].id).toBe('today-2');
  });

  it('breaks ties using source affinity as a secondary signal', () => {
    const cards = [
      makeCard('RESEARCH', 'a', '2026-08-11T12:00:00Z', { source_id: 'src_liked' }),
      makeCard('RESEARCH', 'b', '2026-08-11T11:00:00Z', { source_id: 'src_neutral' }),
    ];
    const affinity = { category: new Map(), source: new Map([['src_liked', 0.6]]) };

    const result = rankByAffinity(cards, affinity);

    expect(result[0].id).toBe('a');
  });
});
