import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../utils/logger.js', () => ({ logger: mocks.mockLogger }));
vi.mock('../../utils/delay.js', () => ({ delay: vi.fn().mockResolvedValue(undefined) }));

import { CryptoNewsFetcher } from '../crypto-news.js';
import type { FetcherConfig } from '@hexcast/shared';

function createFetcher(overrides: Partial<FetcherConfig> = {}): CryptoNewsFetcher {
  return new CryptoNewsFetcher({
    sourceId: 'cryptocurrency.cv/news',
    baseUrl: 'https://cryptocurrency.cv',
    apiType: 'crypto_news_api',
    lastPolledAt: null,
    ...overrides,
  });
}

/**
 * Serves the articles on page 1 and nothing after, because the fetcher walks up to
 * MAX_PAGES. A mock that returns the same page every time yields three copies of every
 * article and makes any length assertion meaningless.
 */
function respondWith(articles: unknown[]) {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ articles: /page=1(&|$)/.test(url) ? articles : [] }),
  })) as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CryptoNewsFetcher field mapping', () => {
  it('reads the API current field names', async () => {
    // The live API returns link / pubDate / description. Reading the old url /
    // published_at / summary produced items with an undefined canonical URL, which failed
    // the NOT NULL constraint on insert and took the rest of the source down with it. The
    // source contributed nothing for an unknown period and the only trace was one error
    // line per run.
    respondWith([
      {
        title: 'Ethereum Fusaka Upgrade Ships',
        source: 'The Block',
        link: 'https://example.com/fusaka',
        pubDate: '2026-08-12T10:00:00Z',
        description: 'The upgrade activated at epoch 364032.',
      },
    ]);

    const results = await createFetcher().fetch();

    expect(results).toHaveLength(1);
    expect(results[0].canonicalUrl).toBe('https://example.com/fusaka');
    expect(results[0].rawText).toBe('The upgrade activated at epoch 364032.');
    expect(results[0].publishedAt).toEqual(new Date('2026-08-12T10:00:00Z'));
  });

  it('still reads the old field names', async () => {
    // Both spellings are accepted because the endpoint is erratic — one probe returned 3
    // articles against a claimed totalCount of 2804, four probes a minute later returned 0.
    // Not worth assuming which shape comes back on a given call.
    respondWith([
      {
        title: 'Legacy Shape',
        source: 'Old API',
        url: 'https://example.com/legacy',
        published_at: '2026-08-11T09:00:00Z',
        summary: 'Body text from the old field.',
      },
    ]);

    const results = await createFetcher().fetch();

    expect(results[0].canonicalUrl).toBe('https://example.com/legacy');
    expect(results[0].rawText).toBe('Body text from the old field.');
  });

  it('skips an article with no url or link instead of emitting one that cannot be stored', async () => {
    // The whole failure this fixes: an item with no canonical URL is unstorable, and
    // emitting it means the insert throws mid-loop and every later item is lost.
    respondWith([
      { title: 'No URL At All', source: 'Broken', pubDate: '2026-08-12T10:00:00Z', description: 'x' },
      {
        title: 'Perfectly Fine',
        source: 'Good',
        link: 'https://example.com/fine',
        pubDate: '2026-08-12T11:00:00Z',
        description: 'y',
      },
    ]);

    const results = await createFetcher().fetch();

    expect(results).toHaveLength(1);
    expect(results[0].rawTitle).toBe('Perfectly Fine');
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('no url or link'));
  });

  it('falls back to the title when the article has no body', async () => {
    respondWith([
      { title: 'Headline Only', source: 'Terse', link: 'https://example.com/terse', pubDate: '2026-08-12T10:00:00Z' },
    ]);

    const results = await createFetcher().fetch();

    expect(results[0].rawText).toBe('Headline Only');
  });

  it('returns nothing when the API serves an empty article list', async () => {
    // Observed repeatedly on the live endpoint: HTTP 200, totalCount 0, articles [].
    respondWith([]);

    expect(await createFetcher().fetch()).toEqual([]);
  });
});
