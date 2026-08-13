import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://hexcast.xyz';

  // Only publicly reachable pages belong here. `/feed` and `/sources` are gated (the
  // middleware redirects a crawler with no session to /sign-in), so listing them just
  // feeds Search Console "page with redirect" errors. `/` (landing) and `/about` (the
  // how-it-works / accuracy page) are public; card permalinks are public and added
  // below.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 },
  ];

  // Dynamic card pages — last 500 cards
  const { data: cards } = await supabase
    .from('cards')
    .select('id, published_at')
    .eq('is_suspended', false)
    .order('published_at', { ascending: false })
    .limit(500);

  const cardPages: MetadataRoute.Sitemap = (cards ?? []).map((card) => ({
    url: `${baseUrl}/card/${card.id}`,
    lastModified: new Date(card.published_at),
    changeFrequency: 'never' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...cardPages];
}
