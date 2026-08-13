import { redirect } from 'next/navigation';
import { auth } from '@/lib/server-auth';
import { getPersonalizedCards } from '@/lib/queries';
import { CardFeed } from '@/components/card-feed';
import { cappedLimit } from '@/lib/feed-cap';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed · Hexcast' };

export default async function FeedPage() {
  // The feed requires an account. The middleware already redirects a cookie-less
  // visitor; this is the real check (validates the session against the DB), so a
  // stale or forged cookie can't reach the feed either. There is no anonymous feed.
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  // Dev deploy caps the feed to MAX_FEED_CARDS; unset in prod for the full feed (#59).
  const limit = cappedLimit(20);
  const result = await getPersonalizedCards({ userId, limit });
  return (
    <CardFeed
      initialCards={result.cards}
      personalized
      initialUnseenCount={result.unseenCount}
    />
  );
}
