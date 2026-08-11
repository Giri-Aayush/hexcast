import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

// ── Free Crypto News API types ────────────────────────────────────────

interface CryptoNewsArticle {
  title: string;
  source: string;
  url: string;
  published_at: string;
  summary?: string;
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

          const publishedAt = article.published_at
            ? new Date(article.published_at)
            : null;

          if (publishedAt && !this.isAfterLastPoll(publishedAt)) continue;

          allOld = false;

          results.push({
            sourceId: this.config.sourceId,
            canonicalUrl: article.url,
            rawTitle: article.title,
            rawText: article.summary || article.title,
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
