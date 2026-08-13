import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Total cards published since launch, for the landing page's live counter.
 *
 * Counts every card ever written, not just the currently-visible ones, so the
 * number only ever goes up — a "since launch" tally that drops when a card is
 * suspended would read as a bug. `head: true` fetches the count without the rows.
 *
 * Cached briefly at the edge: the landing counter polls this, and a launch-day
 * crowd polling a live DB count every few seconds does not each need a fresh query.
 */
export async function GET() {
  const { count, error } = await supabase
    .from('cards')
    .select('*', { count: 'exact', head: true });

  if (error) {
    // The counter keeps its last value on a null; never 500 the landing page.
    return NextResponse.json({ count: null }, { status: 200 });
  }

  return NextResponse.json(
    { count: count ?? 0 },
    { headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' } },
  );
}
