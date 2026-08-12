import { auth } from '@/lib/server-auth';
import { getCards, getPersonalizedCards } from '@/lib/queries';
import { CardFeed } from '@/components/card-feed';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    const result = await getPersonalizedCards({ userId, limit: 20 });
    return (
      <CardFeed
        initialCards={result.cards}
        personalized
        initialUnseenCount={result.unseenCount}
      />
    );
  }

  const cards = await getCards({ limit: 20 });
  return <CardFeed initialCards={cards} />;
}
