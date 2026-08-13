import { redirect } from 'next/navigation';
import { auth } from '@/lib/server-auth';
import { getPersonalizedCards, getCardById } from '@/lib/queries';
import { CardFeed } from '@/components/card-feed';
import { cappedLimit } from '@/lib/feed-cap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed · Hexcast' };

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ card?: string }>;
}) {
  // The feed requires an account. The middleware already redirects a cookie-less
  // visitor; this is the real check (validates the session against the DB), so a
  // stale or forged cookie can't reach the feed either. There is no anonymous feed.
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  // Dev deploy caps the feed to MAX_FEED_CARDS; unset in prod for the full feed (#59).
  const limit = cappedLimit(20);
  const result = await getPersonalizedCards({ userId, limit });

  // Derive hasMore from the real page fill, BEFORE any focus card is prepended —
  // otherwise the extra card makes the count 21 and the old `length === 20` seed in
  // CardFeed silently disabled infinite scroll.
  const hasMore = result.cards.length === limit;

  // Deep link: /feed?card=<id> (a permalink's "Open the full feed", or a saved card)
  // opens the feed *on* that card instead of at the top. Prepend it and drop any
  // duplicate so the snap-scroll lands on it; seen=true so it doesn't inflate unseen.
  let cards: (typeof result.cards)[number][] = result.cards;
  const { card: focusId } = await searchParams;
  if (focusId) {
    const focus = await getCardById(focusId);
    if (focus) {
      cards = [{ ...focus, seen: true }, ...result.cards.filter((c) => c.id !== focus.id)];
    }
  }

  return (
    <CardFeed
      initialCards={cards}
      personalized
      initialHasMore={hasMore}
      initialUnseenCount={result.unseenCount}
    />
  );
}
