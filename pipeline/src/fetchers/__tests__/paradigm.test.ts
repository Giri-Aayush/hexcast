import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ParadigmFetcher } from '../paradigm.js';

// ── Fixtures ─────────────────────────────────────────────────────────────

function sitemap(entries: Array<{ path: string; lastmod?: string }>): string {
  const urls = entries
    .map(
      ({ path, lastmod }) =>
        `<url><loc>https://www.paradigm.xyz${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls}</urlset>`;
}

function articlePage({
  title = 'Some Research',
  published = '2026-08-10T12:00:00.000Z',
  body = 'First paragraph of real content.',
  author = 'Researcher',
}: { title?: string; published?: string; body?: string; author?: string } = {}): string {
  return `<html><head>
      <meta property="og:title" content="${title}">
      <meta property="article:published_time" content="${published}">
      <meta name="author" content="${author}">
    </head><body><article><p>${body}</p></article></body></html>`;
}

function config(lastPolledAt: Date | null = null) {
  return {
    sourceId: 'paradigm.xyz',
    baseUrl: 'https://www.paradigm.xyz',
    apiType: 'paradigm_scraper',
    lastPolledAt,
  };
}

/** Route each URL to a canned response so tests read as request→response pairs. */
function mockRoutes(routes: Record<string, string | number>) {
  return vi.fn(async (url: string) => {
    for (const [match, body] of Object.entries(routes)) {
      if (url.includes(match)) {
        if (typeof body === 'number') return { ok: false, status: body } as Response;
        return { ok: true, status: 200, text: async () => body } as Response;
      }
    }
    return { ok: false, status: 404 } as Response;
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('ParadigmFetcher', () => {
  it('ignores sitemap entries that are not articles', async () => {
    vi.stubGlobal(
      'fetch',
      mockRoutes({
        '/sitemap.xml': sitemap([
          { path: '/careers', lastmod: '2026-08-11T00:00:00.000Z' },
          { path: '/frontiers-2026', lastmod: '2026-08-11T00:00:00.000Z' },
          { path: '/writing/real-post', lastmod: '2026-08-11T00:00:00.000Z' },
        ]),
        '/writing/real-post': articlePage(),
      }),
    );

    const results = await new ParadigmFetcher(config()).fetch();

    expect(results).toHaveLength(1);
    expect(results[0].canonicalUrl).toBe('https://www.paradigm.xyz/writing/real-post');
  });

  it('only opens articles whose lastmod is newer than the last poll', async () => {
    const fetchMock = mockRoutes({
      '/sitemap.xml': sitemap([
        { path: '/writing/fresh', lastmod: '2026-08-11T00:00:00.000Z' },
        { path: '/writing/stale', lastmod: '2026-01-01T00:00:00.000Z' },
      ]),
      '/writing/fresh': articlePage({ published: '2026-08-11T00:00:00.000Z' }),
      '/writing/stale': articlePage({ published: '2026-01-01T00:00:00.000Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await new ParadigmFetcher(config(new Date('2026-08-01T00:00:00.000Z'))).fetch();

    expect(results.map((r) => r.canonicalUrl)).toEqual(['https://www.paradigm.xyz/writing/fresh']);
    // The stale page must not be requested at all — that is the whole point of
    // reading the sitemap first instead of dating every article.
    const requested = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(requested.some((u) => u.includes('/writing/stale'))).toBe(false);
  });

  it('dates the item by publication, not by lastmod', async () => {
    // Measured case: evmbench had lastmod 2026-08-11 but was published 2026-02-18.
    // An edit to an old post must not be dated as if it were new.
    vi.stubGlobal(
      'fetch',
      mockRoutes({
        '/sitemap.xml': sitemap([{ path: '/writing/evmbench', lastmod: '2026-08-11T16:13:11.068Z' }]),
        '/writing/evmbench': articlePage({ published: '2026-02-18T17:58:27.863Z' }),
      }),
    );

    const results = await new ParadigmFetcher(config()).fetch();

    expect(results[0].publishedAt?.toISOString()).toBe('2026-02-18T17:58:27.863Z');
  });

  it('drops an edited old post rather than resurfacing it as news', async () => {
    vi.stubGlobal(
      'fetch',
      mockRoutes({
        // Recently modified, so it passes the sitemap filter...
        '/sitemap.xml': sitemap([{ path: '/writing/evmbench', lastmod: '2026-08-11T16:13:11.068Z' }]),
        // ...but it was published long before the last poll.
        '/writing/evmbench': articlePage({ published: '2026-02-18T17:58:27.863Z' }),
      }),
    );

    const results = await new ParadigmFetcher(config(new Date('2026-08-01T00:00:00.000Z'))).fetch();

    expect(results).toHaveLength(0);
  });

  it('falls back to JSON-LD when the og date tag is missing', async () => {
    const page = `<html><head>
        <meta property="og:title" content="No Og Date">
        <script type="application/ld+json">{"datePublished":"2026-07-01T00:00:00.000Z"}</script>
      </head><body><article><p>Body.</p></article></body></html>`;
    vi.stubGlobal(
      'fetch',
      mockRoutes({
        '/sitemap.xml': sitemap([{ path: '/writing/p', lastmod: '2026-07-01T00:00:00.000Z' }]),
        '/writing/p': page,
      }),
    );

    const results = await new ParadigmFetcher(config()).fetch();

    expect(results[0].publishedAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('keeps going when one article fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      mockRoutes({
        '/sitemap.xml': sitemap([
          { path: '/writing/broken', lastmod: '2026-08-11T02:00:00.000Z' },
          { path: '/writing/fine', lastmod: '2026-08-11T01:00:00.000Z' },
        ]),
        '/writing/broken': 500,
        '/writing/fine': articlePage(),
      }),
    );

    const results = await new ParadigmFetcher(config()).fetch();

    expect(results.map((r) => r.canonicalUrl)).toEqual(['https://www.paradigm.xyz/writing/fine']);
  });

  it('caps how many articles a cold run opens', async () => {
    // A cold start has ~250 candidates; opening all of them in one run is not ok.
    const entries = Array.from({ length: 40 }, (_, i) => ({
      path: `/writing/post-${i}`,
      lastmod: `2026-08-${String(11 - (i % 10)).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const fetchMock = mockRoutes({
      '/sitemap.xml': sitemap(entries),
      '/writing/post-': articlePage(),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new ParadigmFetcher(config()).fetch();

    const articleRequests = fetchMock.mock.calls
      .map((c) => c[0] as string)
      .filter((u) => u.includes('/writing/'));
    expect(articleRequests.length).toBeLessThanOrEqual(15);
  });

  it('returns nothing when the sitemap is unreachable', async () => {
    vi.stubGlobal('fetch', mockRoutes({ '/sitemap.xml': 503 }));

    const results = await new ParadigmFetcher(config()).fetch();

    expect(results).toEqual([]);
  });
});
