import { supabase } from './supabase';
import type { PersonalizedCard } from './queries';

/**
 * Reaction-weighted personalization (v1, app-layer).
 *
 * The feed's freshness guarantee (`get_personalized_feed` orders unseen-first,
 * then `published_at DESC`) has to keep dominating: a card from a favorite
 * category must never outrank a fresher one just because the user liked it more.
 * We enforce that structurally rather than by tuning a blend weight — see
 * `rankByAffinity` below. Affinity only ever reorders cards that are already
 * roughly as fresh as each other.
 */

// How many extra unseen candidates to pull past `limit` so there's room to
// re-rank by affinity without ever reaching into older cards to do it.
// 3x gives a few same-day cards to work with on a typical page without
// fetching a wildly oversized batch.
export const CANDIDATE_MULTIPLIER = 3;

// Hard ceiling on the candidate pool regardless of `limit`, so a large page
// size (e.g. the /api/cards `limit=50` cap) can't blow up the RPC call.
export const MAX_CANDIDATE_POOL = 150;

// Divisor in tanh(net / K) when squashing (upvotes - downvotes) to ~[-1, 1].
// Small on purpose: a handful of reactions should already produce a visible
// nudge, and tanh's saturation keeps one heavy reactor from swamping the score.
const AFFINITY_K = 3;

// Category affinity is weighted above source affinity — many sources share a
// category, so category is the stronger, more stable signal. Source is a
// secondary tiebreaker within it. Both are already ~[-1, 1], so the combined
// score stays ~[-1, 1] too.
const CATEGORY_WEIGHT = 0.7;
const SOURCE_WEIGHT = 0.3;

export interface AffinityScores {
  category: Map<string, number>;
  source: Map<string, number>;
}

function emptyAffinity(): AffinityScores {
  return { category: new Map(), source: new Map() };
}

interface ReactionWithCard {
  reaction: string;
  cards: { category: string; source_id: string } | null;
}

/**
 * Net (upvotes - downvotes) per category and per source, squashed to ~[-1, 1].
 * A user with no reactions — new users, users who only view cards — gets both
 * maps empty, which `rankByAffinity` treats as a strict no-op. Any failure
 * (RPC/network/shape) also degrades to empty rather than surfacing: this must
 * never be the reason the feed 500s.
 */
export async function computeAffinity(userId: string): Promise<AffinityScores> {
  try {
    const { data, error } = await supabase
      .from('reactions')
      .select('reaction, cards(category, source_id)')
      .eq('user_id', userId);

    if (error || !data) return emptyAffinity();

    const categoryNet = new Map<string, number>();
    const sourceNet = new Map<string, number>();

    for (const row of data as unknown as ReactionWithCard[]) {
      const card = row.cards;
      if (!card) continue; // joined card missing (deleted) — skip, don't guess
      const delta = row.reaction === 'up' ? 1 : row.reaction === 'down' ? -1 : 0;
      if (delta === 0) continue;
      categoryNet.set(card.category, (categoryNet.get(card.category) ?? 0) + delta);
      sourceNet.set(card.source_id, (sourceNet.get(card.source_id) ?? 0) + delta);
    }

    const category = new Map<string, number>();
    for (const [key, net] of categoryNet) category.set(key, Math.tanh(net / AFFINITY_K));

    const source = new Map<string, number>();
    for (const [key, net] of sourceNet) source.set(key, Math.tanh(net / AFFINITY_K));

    return { category, source };
  } catch {
    return emptyAffinity();
  }
}

/** @internal Exported for testing */
export function scoreCard(card: PersonalizedCard, affinity: AffinityScores): number {
  const categoryScore = affinity.category.get(card.category) ?? 0;
  const sourceScore = affinity.source.get(card.source_id) ?? 0;
  return CATEGORY_WEIGHT * categoryScore + SOURCE_WEIGHT * sourceScore;
}

/**
 * Bucket-then-affinity ranking: freshness is the primary sort, affinity only
 * breaks ties within a bucket.
 *
 * `cards` must already be sorted newest-first (the RPC's own ordering) —
 * bucketing by calendar day of `published_at` then relies on that to put
 * newer days ahead of older ones. Within a day, cards are sorted by affinity
 * score (liked categories/sources first, disliked last), using a stable sort
 * so ties — critically, an all-zero affinity — preserve the incoming recency
 * order exactly. That's what makes a no-reaction user's feed identical to the
 * unweighted feed: there's no separate "is this a no-op" branch to keep in
 * sync, the sort just doesn't move anything.
 *
 * A stale card can only ever move ahead of cards from its own day — never
 * ahead of a card from a newer day — because the bucket boundary is checked
 * first and buckets are concatenated newest-first.
 */
export function rankByAffinity(
  cards: PersonalizedCard[],
  affinity: AffinityScores,
): PersonalizedCard[] {
  if (cards.length <= 1) return cards;
  if (affinity.category.size === 0 && affinity.source.size === 0) return cards;

  const buckets = new Map<string, PersonalizedCard[]>();
  for (const card of cards) {
    const day = card.published_at.slice(0, 10); // calendar day (UTC), e.g. "2026-08-11"
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(card);
  }

  const result: PersonalizedCard[] = [];
  for (const bucket of buckets.values()) {
    const ranked = [...bucket].sort((a, b) => scoreCard(b, affinity) - scoreCard(a, affinity));
    result.push(...ranked);
  }
  return result;
}
