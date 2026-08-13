import { auth } from '@/lib/server-auth';
import { getCards, getPersonalizedCards } from '@/lib/queries';
import { CardFeed } from '@/components/card-feed';
import { cappedLimit } from '@/lib/feed-cap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed · Hexcast' };

export default async function FeedPage() {
  const { userId } = await auth();
  // Dev deploy caps the feed to MAX_FEED_CARDS; unset in prod for the full feed (#59).
  const limit = cappedLimit(20);

  if (userId) {
    const result = await getPersonalizedCards({ userId, limit });
    return (
      <CardFeed
        initialCards={result.cards}
        personalized
        initialUnseenCount={result.unseenCount}
      />
    );
  }

  const cards = await getCards({ limit });
  return <CardFeed initialCards={cards} />;
}
