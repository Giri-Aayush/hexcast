import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Card, SourceRegistry } from '@hexcast/shared';

// --- Fluent chain mock using vi.hoisted ---

const { mockSupabase, mockResult } = vi.hoisted(() => {
  // Configurable result that the chain resolves to
  const mockResult = { data: null as any, error: null as any };

  // Create a chainable mock: every method returns the chain,
  // and the chain is a thenable so `await query` resolves with mockResult.
  const chain: any = {};
  const methods = ['from', 'select', 'eq', 'lt', 'order', 'limit', 'maybeSingle'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Make the chain thenable (awaitable)
  chain.then = (resolve: (v: any) => any) => resolve(mockResult);

  // rpc returns the chain too (for getPersonalizedCards)
  const mockSupabase = {
    from: chain.from,
    rpc: vi.fn().mockReturnValue(chain),
  };

  return { mockSupabase, mockResult, chain };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
}));

import {
  interleaveBySource,
  getCards,
  getPersonalizedCards,
  getCardById,
  getSources,
} from '../queries';

// --- Helpers ---

function makeCard(category: string, id?: string, overrides?: Partial<Card>): Card {
  return {
    id: id ?? crypto.randomUUID(),
    source_id: 'test',
    canonical_url: 'https://example.com',
    url_hash: 'abc',
    headline: 'Test',
    summary: 'Test summary',
    category,
    quality_score: 0.8,
    author: null,
    engagement: null,
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    is_suspended: false,
    flag_count: 0,
    reaction_up_count: 0,
    reaction_down_count: 0,
    pipeline_version: '1.0.0',
    ...overrides,
  } as Card;
}

function makeSource(id: string, displayName: string): SourceRegistry {
  return {
    id,
    display_name: displayName,
    base_url: `https://${displayName.toLowerCase()}.com`,
    api_type: null,
    poll_interval_s: 300,
    default_category: 'RESEARCH' as any,
    is_active: true,
    last_polled_at: null,
  } as SourceRegistry;
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  mockResult.data = null;
  mockResult.error = null;
});

// ===================================================================
// interleaveBySource (existing tests preserved)
// ===================================================================

describe('interleaveBySource', () => {
  it('returns an empty array for empty input', () => {
    expect(interleaveBySource([])).toEqual([]);
  });

  it('returns the same card for a single-element array', () => {
    const card = makeCard('RESEARCH', 'single');
    const result = interleaveBySource([card]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('single');
  });

  it('interleaves cards from 2 categories in round-robin', () => {
    const cards = [
      makeCard('GOVERNANCE', 'g1'),
      makeCard('GOVERNANCE', 'g2'),
      makeCard('RESEARCH', 'r1'),
      makeCard('RESEARCH', 'r2'),
    ];
    const result = interleaveBySource(cards);
    expect(result).toHaveLength(4);
    // Round-robin: no two consecutive cards should share a category
    for (let i = 1; i < result.length; i++) {
      expect(result[i].category).not.toBe(result[i - 1].category);
    }
  });

  it('handles imbalanced categories by spreading the largest category', () => {
    const cards = [
      makeCard('GOVERNANCE', 'g1'),
      makeCard('GOVERNANCE', 'g2'),
      makeCard('GOVERNANCE', 'g3'),
      makeCard('RESEARCH', 'r1'),
      makeCard('SECURITY', 's1'),
    ];
    const result = interleaveBySource(cards);
    expect(result).toHaveLength(5);
    // Round-robin distributes GOV across rounds: GOV, RESEARCH, SECURITY, GOV, GOV
    // The first card from each round should alternate categories
    expect(result[0].category).toBe('GOVERNANCE');
    expect(result[1].category).not.toBe('GOVERNANCE');
    expect(result[2].category).not.toBe('GOVERNANCE');
    // All original cards are present
    const categories = result.map((c) => c.category);
    expect(categories.filter((c) => c === 'GOVERNANCE')).toHaveLength(3);
    expect(categories.filter((c) => c === 'RESEARCH')).toHaveLength(1);
    expect(categories.filter((c) => c === 'SECURITY')).toHaveLength(1);
  });

  it('preserves total card count', () => {
    const cards = [
      makeCard('GOVERNANCE', 'g1'),
      makeCard('GOVERNANCE', 'g2'),
      makeCard('RESEARCH', 'r1'),
      makeCard('SECURITY', 's1'),
      makeCard('SECURITY', 's2'),
      makeCard('UPGRADE', 'u1'),
    ];
    const result = interleaveBySource(cards);
    expect(result).toHaveLength(cards.length);
  });

  it('works with a single category (all returned in same order)', () => {
    const cards = [
      makeCard('RESEARCH', 'r1'),
      makeCard('RESEARCH', 'r2'),
      makeCard('RESEARCH', 'r3'),
    ];
    const result = interleaveBySource(cards);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('handles 4+ categories', () => {
    const cards = [
      makeCard('GOVERNANCE', 'g1'),
      makeCard('GOVERNANCE', 'g2'),
      makeCard('RESEARCH', 'r1'),
      makeCard('RESEARCH', 'r2'),
      makeCard('SECURITY', 's1'),
      makeCard('SECURITY', 's2'),
      makeCard('UPGRADE', 'u1'),
      makeCard('UPGRADE', 'u2'),
    ];
    const result = interleaveBySource(cards);
    expect(result).toHaveLength(8);
    // With 4 equal categories, no two consecutive should share a category
    for (let i = 1; i < result.length; i++) {
      expect(result[i].category).not.toBe(result[i - 1].category);
    }
  });
});

// ===================================================================
// getCards
// ===================================================================

describe('getCards', () => {
  it('returns cards with no params (defaults)', async () => {
    const cards = [makeCard('RESEARCH', 'c1')];
    mockResult.data = cards;

    const result = await getCards();

    expect(mockSupabase.from).toHaveBeenCalledWith('cards');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('applies .lt("published_at", cursor) when cursor is provided', async () => {
    const cards = [makeCard('RESEARCH', 'c1')];
    mockResult.data = cards;

    // Access the chain object to check .lt was called
    const chain = mockSupabase.from('cards');
    await getCards({ cursor: '2024-06-01T00:00:00Z' });

    expect(chain.lt).toHaveBeenCalledWith('published_at', '2024-06-01T00:00:00Z');
  });

  it('applies .eq("category", category) when category is provided', async () => {
    mockResult.data = [];

    const chain = mockSupabase.from('cards');
    await getCards({ category: 'GOVERNANCE' });

    expect(chain.eq).toHaveBeenCalledWith('category', 'GOVERNANCE');
  });

  it('applies .eq("source_id", source) when source is provided', async () => {
    mockResult.data = [];

    const chain = mockSupabase.from('cards');
    await getCards({ source: 'ethresear_ch' });

    expect(chain.eq).toHaveBeenCalledWith('source_id', 'ethresear_ch');
  });

  it('applies all filters when cursor, category, and source are all provided', async () => {
    mockResult.data = [];

    const chain = mockSupabase.from('cards');
    await getCards({
      cursor: '2024-01-01T00:00:00Z',
      category: 'SECURITY',
      source: 'rekt_news',
      limit: 10,
    });

    expect(chain.lt).toHaveBeenCalledWith('published_at', '2024-01-01T00:00:00Z');
    expect(chain.eq).toHaveBeenCalledWith('category', 'SECURITY');
    expect(chain.eq).toHaveBeenCalledWith('source_id', 'rekt_news');
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it('throws on DB error', async () => {
    mockResult.error = { message: 'connection refused' };

    await expect(getCards()).rejects.toThrow('Failed to fetch cards: connection refused');
  });

  it('returns empty array when data is null', async () => {
    mockResult.data = null;
    mockResult.error = null;

    const result = await getCards();
    expect(result).toEqual([]);
  });
});

// ===================================================================
// getPersonalizedCards
// ===================================================================

describe('getPersonalizedCards', () => {
  it('calls rpc with correct params for basic call', async () => {
    mockResult.data = [];

    await getPersonalizedCards({ userId: 'user_abc' });

    // p_limit is the overfetched candidate pool (limit * CANDIDATE_MULTIPLIER),
    // not the raw page size — see affinity.test.ts for the multiplier itself.
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_personalized_feed', {
      p_user_id: 'user_abc',
      p_limit: 60,
      p_category: null,
      p_cursor_seen: null,
      p_cursor_published: null,
      p_max_age_days: 365,
    });
  });

  it('separates seen/unseen and interleaves each zone', async () => {
    const unseenCards = [
      { ...makeCard('GOVERNANCE', 'u1'), seen: false },
      { ...makeCard('GOVERNANCE', 'u2'), seen: false },
      { ...makeCard('RESEARCH', 'u3'), seen: false },
    ];
    const seenCards = [
      { ...makeCard('SECURITY', 's1'), seen: true },
      { ...makeCard('SECURITY', 's2'), seen: true },
      { ...makeCard('UPGRADE', 's3'), seen: true },
    ];
    mockResult.data = [...unseenCards, ...seenCards];

    const result = await getPersonalizedCards({ userId: 'user_abc' });

    // Unseen cards come first, then seen cards
    expect(result.unseenCount).toBe(3);
    expect(result.cards).toHaveLength(6);

    // First 3 cards should be unseen (interleaved)
    const firstThree = result.cards.slice(0, 3);
    for (const c of firstThree) {
      expect(c.seen).toBe(false);
    }

    // Last 3 cards should be seen (interleaved)
    const lastThree = result.cards.slice(3);
    for (const c of lastThree) {
      expect(c.seen).toBe(true);
    }
  });

  it('passes all params to RPC including optional ones', async () => {
    mockResult.data = [];

    await getPersonalizedCards({
      userId: 'user_xyz',
      limit: 50,
      category: 'GOVERNANCE',
      cursorSeen: true,
      cursorPublished: '2024-06-01T00:00:00Z',
    });

    // 50 * CANDIDATE_MULTIPLIER (3) = 150, right at MAX_CANDIDATE_POOL — not clamped.
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_personalized_feed', {
      p_user_id: 'user_xyz',
      p_limit: 150,
      p_category: 'GOVERNANCE',
      p_cursor_seen: true,
      p_cursor_published: '2024-06-01T00:00:00Z',
      p_max_age_days: 365,
    });
  });

  it('throws on DB error', async () => {
    mockResult.error = { message: 'rpc failed' };

    await expect(
      getPersonalizedCards({ userId: 'user_abc' }),
    ).rejects.toThrow('Failed to fetch personalized feed: rpc failed');
  });

  it('returns empty cards and 0 unseenCount when data is null', async () => {
    mockResult.data = null;
    mockResult.error = null;

    const result = await getPersonalizedCards({ userId: 'user_abc' });

    expect(result.cards).toEqual([]);
    expect(result.unseenCount).toBe(0);
  });
});

// ===================================================================
// getCardById
// ===================================================================

describe('getCardById', () => {
  it('returns card when found', async () => {
    const card = makeCard('RESEARCH', 'card-123');
    mockResult.data = card;

    const result = await getCardById('card-123');

    expect(result).toEqual(card);
    expect(mockSupabase.from).toHaveBeenCalledWith('cards');
  });

  it('returns null when not found', async () => {
    mockResult.data = null;
    mockResult.error = null;

    const result = await getCardById('nonexistent');

    expect(result).toBeNull();
  });

  it('throws on DB error', async () => {
    mockResult.error = { message: 'row level security violation' };

    await expect(getCardById('card-123')).rejects.toThrow(
      'Failed to fetch card: row level security violation',
    );
  });

  it('excludes suspended cards', async () => {
    // Both feed paths already filtered this; the permalink did not, so a suspended
    // card stayed readable at /card/<id> — the URL people share, and the one place
    // a bad card is most likely to be seen. Suspension has to hold here too.
    mockResult.data = makeCard('RESEARCH', 'card-123');

    await getCardById('card-123');

    const chain = mockSupabase.from.mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('is_suspended', false);
  });
});

// ===================================================================
// getSources
// ===================================================================

describe('getSources', () => {
  it('returns active sources', async () => {
    const sources = [
      makeSource('src1', 'EthResearch'),
      makeSource('src2', 'Ethereum Magicians'),
    ];
    mockResult.data = sources;

    const result = await getSources();

    expect(result).toEqual(sources);
    expect(result).toHaveLength(2);
    expect(mockSupabase.from).toHaveBeenCalledWith('source_registry');
  });

  it('throws on DB error', async () => {
    mockResult.error = { message: 'table not found' };

    await expect(getSources()).rejects.toThrow('Failed to fetch sources: table not found');
  });

  it('returns empty array when data is null', async () => {
    mockResult.data = null;
    mockResult.error = null;

    const result = await getSources();
    expect(result).toEqual([]);
  });
});
