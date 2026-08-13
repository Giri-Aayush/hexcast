import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { CATEGORY_LABELS } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const CATEGORIES = Object.keys(CATEGORY_LABELS);

/**
 * Live public stats for the landing/about copy and the feed's filter chip:
 *   count      — total cards ever written (a "since launch" tally that only goes up;
 *                a number that dropped when a card was suspended would read as a bug)
 *   sources    — active monitored sources
 *   byCategory — non-suspended card count per category. The feed chip shows the total
 *                for the active filter (sum for ALL) instead of the number loaded so
 *                far, which read like the feed only had 20 cards.
 *
 * Counted here rather than hardcoded so nothing goes stale as cards/sources are added
 * — the exact failure mode of the old "88 sources" / "60 words" strings. `head: true`
 * fetches counts without the rows. Errors return null/0 so callers fall back to their
 * last value; never 500 the page.
 *
 * Cached briefly at the edge: the landing counter polls this, and a launch-day crowd
 * polling a live DB count every few seconds does not each need a fresh query.
 */
export async function GET() {
  const [cards, sources, ...catResults] = await Promise.all([
    supabase.from('cards').select('*', { count: 'exact', head: true }),
    supabase.from('source_registry').select('*', { count: 'exact', head: true }).eq('is_active', true),
    // Feed-visible (non-suspended) counts, one per category.
    ...CATEGORIES.map((c) =>
      supabase.from('cards').select('*', { count: 'exact', head: true }).eq('is_suspended', false).eq('category', c),
    ),
  ]);

  const byCategory: Record<string, number> = {};
  CATEGORIES.forEach((c, i) => {
    const r = catResults[i];
    byCategory[c] = r.error ? 0 : r.count ?? 0;
  });

  return NextResponse.json(
    {
      count: cards.error ? null : cards.count ?? 0,
      sources: sources.error ? null : sources.count ?? 0,
      byCategory,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
