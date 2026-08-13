import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Gated or non-indexable surfaces: crawlers get a redirect to /sign-in on the
        // gated ones, so keep them out of the crawl entirely. Public pages (/, /about,
        // /card/*) stay allowed.
        disallow: ['/api/', '/admin/', '/feed', '/saved', '/sources', '/sign-in'],
      },
    ],
    sitemap: 'https://hexcast.xyz/sitemap.xml',
  };
}
