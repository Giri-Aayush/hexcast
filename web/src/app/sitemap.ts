import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://hexcast.xyz';

  // Static pages. `/` is now the landing page (static marketing), and the feed moved
  // to `/feed` — so `/feed` is the hourly-changing surface, not the root.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'weekly', priority: 1.0 },
    { url: `${baseUrl}/feed`, lastModified: new Date(), changeFrequency: 'hourly', priority: 0.9 },
    { url: `${baseUrl}/sources`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
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
