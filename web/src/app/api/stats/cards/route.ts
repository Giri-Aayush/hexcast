import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Live public stats for the landing/about copy:
 *   count   — total cards ever written (a "since launch" tally that only goes up;
 *             a number that dropped when a card was suspended would read as a bug)
 *   sources — active monitored sources
 *
 * Both are counted here rather than hardcoded in the copy so they never go stale
 * as sources are added — the exact failure mode of the old "88 sources" / "60
 * words" / "61 sources" strings. `head: true` fetches counts without the rows.
 * Errors return null so the copy falls back to its last value; never 500 the page.
 *
 * Cached briefly at the edge: the landing counter polls this, and a launch-day
 * crowd polling a live DB count every few seconds does not each need a fresh query.
 */
export async function GET() {
  const [cards, sources] = await Promise.all([
    supabase.from('cards').select('*', { count: 'exact', head: true }),
    supabase.from('source_registry').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  return NextResponse.json(
    {
      count: cards.error ? null : cards.count ?? 0,
      sources: sources.error ? null : sources.count ?? 0,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
