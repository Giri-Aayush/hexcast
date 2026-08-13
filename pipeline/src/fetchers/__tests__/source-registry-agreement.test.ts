import { describe, it, expect } from 'vitest';
import { ALL_SOURCES } from '@hexcast/shared';
import { RSS_FEEDS } from '../rss.js';

/**
 * Two lists decide whether a source works, and nothing made them agree.
 *
 * `ALL_SOURCES` in packages/shared decides what gets POLLED. `RSS_FEEDS` in rss.ts decides
 * what URL is actually REQUESTED. A source in the first but not the second hits this, in
 * RssFetcher.fetch:
 *
 *   const feedUrl = RSS_FEEDS[this.config.sourceId];
 *   if (!feedUrl) {
 *     logger.warn(`No RSS feed URL configured for ${this.config.sourceId}`);
 *     return [];
 *   }
 *
 * A warning and an empty array. The run then logs "Fetched 0 items from X" and completes
 * successfully, which is indistinguishable from a source that simply had nothing new. So a
 * source can be registered, active, polled on schedule, and contributing nothing, for as long
 * as nobody happens to read a warning line.
 *
 * That is the same invisible-failure shape as three other bugs found in one day: a fetcher
 * reading renamed API fields (#84), a CSP blocking every card image behind an onError
 * fallback (#89), and a motif filter rejecting 100% of its input (#91). Each was silent
 * because the failing path produced a plausible-looking empty result.
 *
 * It is also what made a search error easy to believe: go-ethereum appears in RSS_FEEDS, so
 * grepping one list said nothing about the other, and a source I reported as missing was
 * present and working all along.
 *
 * This test is cheap and it fails at CI time rather than never.
 */
describe('source registry and RSS feed map agree', () => {
  const rssSources = ALL_SOURCES.filter((s) => s.api_type === 'rss');

  it('every source polled as rss has a feed URL', () => {
    const missing = rssSources.filter((s) => !RSS_FEEDS[s.id]).map((s) => s.id);

    expect(missing, `registered as api_type 'rss' but absent from RSS_FEEDS, so they fetch nothing`).toEqual([]);
  });

  it('has no feed URL for a source that no longer exists', () => {
    // The other direction. An orphan is harmless at runtime — nothing looks it up — but it is
    // a claim that a source exists, and it is what a reader greps to answer "do we track X?".
    const ids = new Set(ALL_SOURCES.map((s) => s.id));
    const orphans = Object.keys(RSS_FEEDS).filter((id) => !ids.has(id));

    expect(orphans, 'RSS_FEEDS entries with no matching source in ALL_SOURCES').toEqual([]);
  });

  it('every feed URL is absolute https', () => {
    // A relative or http URL fails at request time, which lands in the same silent bucket.
    const bad = Object.entries(RSS_FEEDS)
      .filter(([, url]) => !url.startsWith('https://'))
      .map(([id, url]) => `${id} -> ${url}`);

    expect(bad).toEqual([]);
  });

  it('has no duplicate feed URLs pointing at the same document', () => {
    // Two sources on one feed produce duplicate raw_items that the deduplicator then has to
    // catch by canonical URL — wasted fetches, and a category count that reads higher than
    // the real coverage.
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const [id, url] of Object.entries(RSS_FEEDS)) {
      const first = seen.get(url);
      if (first) collisions.push(`${first} and ${id} both fetch ${url}`);
      else seen.set(url, id);
    }

    expect(collisions).toEqual([]);
  });

  it('covers a meaningful share of the registry, so a mass deletion is noticed', () => {
    // A canary, not a real assertion about correctness: if RSS_FEEDS were emptied or the
    // source list gutted, every test above would pass on empty inputs. This fails instead.
    expect(rssSources.length).toBeGreaterThan(30);
    expect(Object.keys(RSS_FEEDS).length).toBeGreaterThanOrEqual(rssSources.length);
  });
});
