import * as cheerio from 'cheerio';
import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

/**
 * Scraper for paradigm.xyz/writing.
 *
 * The site used to be Next.js and this fetcher used to read the article list out
 * of `<script id="__NEXT_DATA__">`. It is SvelteKit now, so that script does not
 * exist and the fetcher had been silently returning zero articles.
 *
 * Rather than parse SvelteKit's hydration payload, this reads the sitemap for
 * candidates and the article pages for facts. Two reasons: the payload is an
 * internal format that has already changed provider once and will change again,
 * whereas a sitemap and Open Graph tags are contracts the site maintains for
 * everyone; and the sitemap answers "what changed" in one request instead of the
 * 250+ it would take to date every article.
 *
 * IMPORTANT, do not "optimise" this into an early exit: the /writing listing page
 * is NOT in date order. Measured 2026-08-11, its DOM order ran rsi-simulator
 * (Aug 11), then evmbench (Feb 18), then solidus (Jul 24). Stopping at the first
 * old article would silently skip recent ones, which looks exactly like a quiet
 * news week. The sitemap is sorted, but this filters rather than relying on it.
 */

/** Ceiling on article fetches per run. A cold start has ~250 candidates. */
const MAX_ARTICLES_PER_RUN = 15;

/** Politeness gap between article page requests. */
const ARTICLE_DELAY_MS = 300;

interface SitemapEntry {
  url: string;
  lastmod: Date | null;
}

export class ParadigmFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    const results: FetchResult[] = [];

    try {
      const candidates = this.selectCandidates(await this.fetchSitemap());
      if (candidates.length === 0) {
        logger.info('paradigm.xyz: no changed articles in sitemap');
        return [];
      }

      for (const [index, candidate] of candidates.entries()) {
        if (index > 0) await delay(ARTICLE_DELAY_MS);

        const article = await this.fetchArticle(candidate.url);
        if (!article) continue;

        // lastmod only says the page changed — an edit to an old post bumps it
        // without making it news. publishedAt is the authoritative date, so the
        // relevance check runs on that. Re-checked posts dedupe downstream on
        // canonical_url.
        if (!this.isAfterLastPoll(article.publishedAt)) continue;

        results.push({
          sourceId: this.config.sourceId,
          canonicalUrl: candidate.url,
          rawTitle: article.title,
          rawText: article.text,
          rawMetadata: { authors: article.authors, lastmod: candidate.lastmod?.toISOString() ?? null },
          publishedAt: article.publishedAt,
        });
      }

      logger.info(`paradigm.xyz: ${results.length} new articles`);
    } catch (error) {
      logger.error('Failed to scrape paradigm.xyz:', error);
    }

    return results;
  }

  private async fetchSitemap(): Promise<SitemapEntry[]> {
    const response = await this.fetchWithTimeout(this.buildUrl('/sitemap.xml'), {
      headers: { 'User-Agent': 'Hexcast/1.0 (news aggregator)' },
    });

    if (!response.ok) {
      logger.warn(`paradigm.xyz sitemap returned ${response.status}`);
      return [];
    }

    const $ = cheerio.load(await response.text(), { xmlMode: true });
    const entries: SitemapEntry[] = [];

    $('url').each((_, el) => {
      const url = $(el).find('loc').first().text().trim();
      if (!url.includes('/writing/')) return;

      const lastmodText = $(el).find('lastmod').first().text().trim();
      const lastmod = lastmodText ? new Date(lastmodText) : null;
      entries.push({
        url,
        lastmod: lastmod && !Number.isNaN(lastmod.getTime()) ? lastmod : null,
      });
    });

    return entries;
  }

  /**
   * Narrow the sitemap to the pages worth opening. On an incremental run that is
   * whatever changed since the last poll — usually nothing. On a cold run every
   * article qualifies, so fall back to the newest by lastmod.
   */
  private selectCandidates(entries: SitemapEntry[]): SitemapEntry[] {
    const changed = this.config.lastPolledAt
      ? entries.filter((e) => e.lastmod && e.lastmod.getTime() > this.config.lastPolledAt!.getTime())
      : entries;

    return changed
      .sort((a, b) => (b.lastmod?.getTime() ?? 0) - (a.lastmod?.getTime() ?? 0))
      .slice(0, MAX_ARTICLES_PER_RUN);
  }

  private async fetchArticle(url: string): Promise<{
    title: string | null;
    text: string | null;
    authors: string;
    publishedAt: Date | null;
  } | null> {
    try {
      const response = await this.fetchWithTimeout(url, {
        headers: { 'User-Agent': 'Hexcast/1.0 (news aggregator)' },
      });

      if (!response.ok) {
        logger.warn(`paradigm.xyz: ${url} returned ${response.status}`);
        return null;
      }

      const $ = cheerio.load(await response.text());

      // The date is published three ways. Preferring the og tag over JSON-LD
      // because it is a single value rather than a document we have to parse and
      // navigate; JSON-LD is the fallback if the tag ever disappears.
      const published =
        $('meta[property="article:published_time"]').attr('content') ??
        this.datePublishedFromJsonLd($);
      const publishedAt = published ? new Date(published) : null;

      const title =
        $('meta[property="og:title"]').attr('content')?.trim() ??
        $('h1').first().text().trim() ??
        null;

      // Body paragraphs give the summarizer real content; og:description is a
      // one-line teaser and only used when there is nothing else.
      const paragraphs = $('article p, main p')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter((t) => t.length > 0);

      const text = paragraphs.length > 0
        ? paragraphs.join('\n\n')
        : ($('meta[property="og:description"]').attr('content')?.trim() ?? null);

      const authors = $('meta[name="author"]').attr('content')?.trim() ?? '';

      return {
        title: title || null,
        text,
        authors,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
      };
    } catch (error) {
      logger.warn(`paradigm.xyz: failed to read ${url}: ${String(error)}`);
      return null;
    }
  }

  private datePublishedFromJsonLd($: cheerio.CheerioAPI): string | undefined {
    for (const el of $('script[type="application/ld+json"]').toArray()) {
      try {
        const parsed = JSON.parse($(el).text()) as { datePublished?: string };
        if (parsed?.datePublished) return parsed.datePublished;
      } catch {
        // A malformed block on one page should not stop the others.
      }
    }
    return undefined;
  }
}
