import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

// ── CryptoPanic API v2 (Developer plan) types ────────────────────────

interface CryptoPanicPost {
  title: string;
  description: string | null;
  published_at: string;
  created_at: string;
  kind: string; // "news" | "media"
}

interface CryptoPanicResponse {
  results: CryptoPanicPost[];
  next: string | null;
  previous: string | null;
}

// ── Fetcher ───────────────────────────────────────────────────────────

const FILTER_MAP: Record<string, string> = {
  'cryptopanic.com/trending': 'trending',
  'cryptopanic.com/hot': 'hot',
  'cryptopanic.com/rising': 'rising',
};

const API_BASE = 'https://cryptopanic.com/api/developer/v2/posts/';
const MAX_ITEMS = 50;
const PAGE_DELAY_MS = 2000;

export class CryptoPanicFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    const config = loadConfig();
    const apiKey = config.cryptoPanicApiKey;

    if (!apiKey) {
      logger.warn(
        `${this.config.sourceId}: CRYPTOPANIC_API_KEY not set, skipping`
      );
      return [];
    }

    const filter = FILTER_MAP[this.config.sourceId];
    if (!filter) {
      logger.warn(`Unknown CryptoPanic source: ${this.config.sourceId}`);
      return [];
    }

    const results: FetchResult[] = [];
    let nextUrl: string | null =
      `${API_BASE}?auth_token=${apiKey}&filter=${filter}`;

    while (nextUrl && results.length < MAX_ITEMS) {
      try {
        const res = await fetch(nextUrl);

        if (res.status === 429) {
          logger.warn(
            `${this.config.sourceId}: Rate limited (429), stopping pagination`
          );
          break;
        }

        if (!res.ok) {
          logger.error(
            `${this.config.sourceId}: API error ${res.status}`
          );
          break;
        }

        const data = (await res.json()) as CryptoPanicResponse;

        if (!data.results || data.results.length === 0) break;

        for (const post of data.results) {
          if (results.length >= MAX_ITEMS) break;

          const publishedAt = new Date(post.published_at);
          if (!this.isAfterLastPoll(publishedAt)) continue;

          // Developer plan doesn't include URL — link to CryptoPanic search
          const searchTitle = encodeURIComponent(post.title.slice(0, 80));
          const canonicalUrl = `https://cryptopanic.com/news?search=${searchTitle}`;

          results.push({
            sourceId: this.config.sourceId,
            canonicalUrl,
            rawTitle: post.title,
            rawText: post.description || post.title,
            rawMetadata: {
              kind: post.kind,
              filter,
            },
            publishedAt,
          });
        }

        nextUrl = data.next;

        // Delay between pages to stay within rate limits
        if (nextUrl && results.length < MAX_ITEMS) {
          await delay(PAGE_DELAY_MS);
        }
      } catch (error) {
        logger.error(`${this.config.sourceId}: Fetch error:`, error);
        break;
      }
    }

    logger.info(
      `${this.config.sourceId}: Fetched ${results.length} posts (filter=${filter})`
    );
    return results;
  }
}
