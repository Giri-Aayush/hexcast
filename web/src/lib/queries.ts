import { supabase } from './supabase';
import type { Card, SourceRegistry } from '@hexcast/shared';
import { computeAffinity, rankByAffinity, CANDIDATE_MULTIPLIER, MAX_CANDIDATE_POOL } from './affinity';

export interface CardQueryParams {
  cursor?: string;
  limit?: number;
  category?: string;
  source?: string;
}

export async function getCards(params: CardQueryParams = {}): Promise<Card[]> {
  const { cursor, limit = 20, category, source } = params;

  // Fresh content first (published_at DESC), with fetched_at as tiebreaker.
  // No hard cutoff — older cards load naturally as the user scrolls.
  let query = supabase
    .from('cards')
    .select('*')
    .eq('is_suspended', false)
    .order('published_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(limit);

  if (cursor) {
    query = query.lt('published_at', cursor);
  }
  if (category) {
    query = query.eq('category', category);
  }
  if (source) {
    query = query.eq('source_id', source);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch cards: ${error.message}`);
  return interleaveBySource((data ?? []) as Card[]);
}

/**
 * Interleave cards so no two consecutive cards share the same category.
 * Groups by category (not source_id, since many sources share a category),
 * maintains chronological order within each group, then round-robins
 * across categories for maximum diversity.
 */
/** @internal Exported for testing */
export function interleaveBySource(cards: Card[]): Card[] {
  if (cards.length <= 1) return cards;

  // Group by category
  const byCategory: Map<string, Card[]> = new Map();
  for (const card of cards) {
    if (!byCategory.has(card.category)) byCategory.set(card.category, []);
    byCategory.get(card.category)!.push(card);
  }

  // Sort category groups by size descending so the largest gets spread out
  const queues = [...byCategory.values()].sort((a, b) => b.length - a.length);

  const result: Card[] = [];
  while (result.length < cards.length) {
    let added = false;
    for (const q of queues) {
      if (q.length > 0) {
        result.push(q.shift()!);
        added = true;
      }
    }
    if (!added) break;
  }

  return result;
}

// ── Personalized feed ──

export interface PersonalizedCardQueryParams {
  userId: string;
  limit?: number;
  category?: string;
  cursorSeen?: boolean;
  cursorPublished?: string;
}

export interface PersonalizedCard extends Card {
  seen: boolean;
}

export interface PersonalizedResult {
  cards: PersonalizedCard[];
  unseenCount: number;
}

export async function getPersonalizedCards(
  params: PersonalizedCardQueryParams,
): Promise<PersonalizedResult> {
  const { userId, limit = 20, category, cursorSeen, cursorPublished } = params;

  // Overfetch unseen-first candidates so there's room to re-rank by affinity
  // (see rankByAffinity) without ever needing to reach past `limit` into older
  // cards to fill the page. Capped so a large page size can't blow this up.
  const candidateLimit = Math.min(limit * CANDIDATE_MULTIPLIER, MAX_CANDIDATE_POOL);

  const { data, error } = await supabase.rpc('get_personalized_feed', {
    p_user_id: userId,
    p_limit: candidateLimit,
    p_category: category ?? null,
    p_cursor_seen: cursorSeen ?? null,
    p_cursor_published: cursorPublished ?? null,
    p_max_age_days: 365,
  });

  if (error) throw new Error(`Failed to fetch personalized feed: ${error.message}`);

  const raw = (data ?? []) as PersonalizedCard[];

  // Interleave within each zone separately to preserve unseen-first ordering
  const unseen = raw.filter((c) => !c.seen);
  const seen = raw.filter((c) => c.seen);

  // Affinity only re-ranks the unseen zone. It's a nudge within a recency
  // bucket (rankByAffinity), never a reason to bring seen cards forward or to
  // change the seen-zone's own handling below. Skipped entirely when there's
  // nothing unseen to rank, and degrades to a no-op on any fetch error.
  const affinity = unseen.length > 0 ? await computeAffinity(userId) : { category: new Map(), source: new Map() };
  const rankedUnseen = rankByAffinity(unseen, affinity);

  const interleavedUnseen = interleaveBySource(rankedUnseen) as PersonalizedCard[];
  const interleavedSeen = interleaveBySource(seen) as PersonalizedCard[];

  // Re-attach seen flag (interleaveBySource doesn't strip it, but be explicit)
  const seenIds = new Set(seen.map((c) => c.id));
  // Trim the overfetched candidate pool back down to the page size the caller
  // asked for — unseen fills the page first, seen pads whatever's left, same
  // zoning as before this just has more unseen candidates to draw from.
  const cards = [...interleavedUnseen, ...interleavedSeen].slice(0, limit);
  for (const card of cards) {
    card.seen = seenIds.has(card.id);
  }

  // The get_personalized_feed RPC doesn't select image_url, so feed cards came back
  // without cover art and rendered the dither fallback — every card, the whole feed.
  // (The permalink uses select * and was fine, which is why this hid.) Backfill it for
  // just this page from the cards table: one query, page-sized. The `!card.image_url`
  // guard makes it a no-op if the RPC is ever updated to return the column itself.
  const missingArt = cards.filter((c) => !c.image_url).map((c) => c.id);
  if (missingArt.length > 0) {
    const { data: imgs } = await supabase.from('cards').select('id, image_url').in('id', missingArt);
    if (imgs) {
      const byId = new Map(imgs.map((r) => [r.id, r.image_url as string | null]));
      for (const card of cards) {
        if (!card.image_url) card.image_url = byId.get(card.id) ?? null;
      }
    }
  }

  // Count against the trimmed page, not the overfetched pool — this is what
  // the client accumulates into a running "new cards" total across pages, so
  // it must reflect what was actually delivered, not what was fetched.
  const unseenCount = cards.filter((c) => !c.seen).length;

  return { cards, unseenCount };
}

export async function getCardById(id: string): Promise<Card | null> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    // Suspending a card has to remove it from the permalink too, not just the feed.
    // Both feed paths already filter this; this one did not, so a suspended card
    // vanished from the feed and stayed readable at /card/<id> — the URL people
    // actually share, and so the one place a bad card is most likely to be seen.
    // All three callers are public (the permalink page, its API route, the OG
    // image); /admin reads through /api/admin/cards and is unaffected.
    .eq('is_suspended', false)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch card: ${error.message}`);
  return data as Card | null;
}

export async function getSources(): Promise<SourceRegistry[]> {
  const { data, error } = await supabase
    .from('source_registry')
    .select('*')
    .eq('is_active', true)
    .order('display_name');

  if (error) throw new Error(`Failed to fetch sources: ${error.message}`);
  return (data ?? []) as SourceRegistry[];
}
