import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

// ── Free Crypto News API types ────────────────────────────────────────

/**
 * The API renamed its fields and nothing told us.
 *
 * It now returns `link`, `pubDate` and `description` where it used to return `url`,
 * `published_at` and `summary`. Reading the old names produced items with an undefined
 * canonical URL, which failed the NOT NULL constraint on insert and — before the guard in
 * index.ts — took the rest of the source down with it. The source had been contributing
 * nothing for an unknown period, visible only as one error line per run.
 *
 * Both spellings are accepted rather than just the new ones: the endpoint is erratic (one
 * probe returned 3 articles against a claimed totalCount of 2804, four consecutive probes
 * a minute later returned 0 with totalCount 0), so it is not worth assuming which shape
 * comes back on any given call.
 */
interface CryptoNewsArticle {
  title: string;
  source: string;
  url?: string;
  link?: string;
  published_at?: string;
  pubDate?: string;
  summary?: string;
  description?: string;
  sentiment?: string;
}

interface CryptoNewsResponse {
  articles: CryptoNewsArticle[];
}

// ── Fetcher ───────────────────────────────────────────────────────────

const MAX_PAGES = 3;
const MAX_ITEMS = 100;
const PAGE_DELAY_MS = 500;
const PER_PAGE = 50;

export class CryptoNewsFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    const results: FetchResult[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const url = `https://cryptocurrency.cv/api/news?limit=${PER_PAGE}&page=${page}&lang=en`;
        const res = await fetch(url);

        if (!res.ok) {
          logger.error(
            `${this.config.sourceId}: API error ${res.status} on page ${page}`
          );
          break;
        }

        const data = (await res.json()) as CryptoNewsResponse;

        if (!data.articles || data.articles.length === 0) {
          logger.debug(`${this.config.sourceId}: No more articles on page ${page}`);
          break;
        }

        let allOld = true;

        for (const article of data.articles) {
          if (results.length >= MAX_ITEMS) break;

          const published = article.published_at ?? article.pubDate;
          const publishedAt = published ? new Date(published) : null;

          if (publishedAt && !this.isAfterLastPoll(publishedAt)) continue;

          allOld = false;

          const canonicalUrl = article.url ?? article.link;
          if (!canonicalUrl) {
            logger.warn(`${this.config.sourceId}: article "${article.title}" has no url or link, skipping`);
            continue;
          }

          results.push({
            sourceId: this.config.sourceId,
            canonicalUrl,
            rawTitle: article.title,
            rawText: article.description || article.summary || article.title,
            rawMetadata: {
              source_name: article.source,
              sentiment: article.sentiment ?? null,
            },
            publishedAt,
          });
        }

        // Stop if all items on this page are older than lastPolledAt
        if (allOld) {
          logger.debug(
            `${this.config.sourceId}: All items on page ${page} are old, stopping`
          );
          break;
        }

        if (results.length >= MAX_ITEMS) break;

        // Delay between pages
        if (page < MAX_PAGES) {
          await delay(PAGE_DELAY_MS);
        }
      } catch (error) {
        logger.error(`${this.config.sourceId}: Fetch error on page ${page}:`, error);
        break;
      }
    }

    logger.info(
      `${this.config.sourceId}: Fetched ${results.length} articles`
    );
    return results;
  }
}
