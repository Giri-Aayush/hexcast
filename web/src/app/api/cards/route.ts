import { auth } from '@/lib/server-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getCards, getPersonalizedCards } from '@/lib/queries';
import { cappedLimit, isCapped } from '@/lib/feed-cap';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const category = searchParams.get('category') ?? undefined;
  const source = searchParams.get('source') ?? undefined;
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

    // Anonymous feed — unchanged
    const cursor = searchParams.get('cursor') ?? undefined;
    const cards = await getCards({ cursor, limit, category, source });
    return NextResponse.json({ cards, hasMore: isCapped() ? false : cards.length === limit });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch cards' }, { status: 500 });
  }
}
