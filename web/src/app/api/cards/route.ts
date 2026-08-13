import { auth } from '@/lib/server-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getPersonalizedCards } from '@/lib/queries';
import { cappedLimit, isCapped } from '@/lib/feed-cap';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const category = searchParams.get('category') ?? undefined;
  // MAX_FEED_CARDS caps the whole feed on the dev deploy; unset in prod (#59).
  const limit = cappedLimit(Math.min(Number(searchParams.get('limit') ?? 20), 50));

  try {
    const { userId } = await auth();

    if (userId) {
      // Personalized feed with composite cursor
      const cursorSeen = searchParams.get('cursor_seen');
      const cursorPublished = searchParams.get('cursor_published') ?? undefined;

      const result = await getPersonalizedCards({
        userId,
        limit,
        category,
        cursorSeen: cursorSeen !== null ? cursorSeen === 'true' : undefined,
        cursorPublished,
      });

      return NextResponse.json({
        cards: result.cards,
        // Capped feed is a single fixed page, so loadMore must stop regardless of
        // whether the page happened to fill.
        hasMore: isCapped() ? false : result.cards.length === limit,
        unseenCount: result.unseenCount,
      });
    }

    // The feed is gated behind an account. The page redirects a signed-out visitor,
    // but the API is the other door to the same data — without this, `curl /api/cards`
    // hands the whole feed to anyone. Shareable single cards go through /card/[id],
    // which stays public, so nothing legitimate needs the anonymous list.
    return NextResponse.json({ error: 'Sign in to read the feed' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: 500 });
  }
}
