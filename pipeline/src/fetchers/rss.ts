import RssParser from 'rss-parser';
import * as cheerio from 'cheerio';
import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';

const parser = new RssParser();

const CONTENT_SELECTORS: Record<string, string> = {
  'blog.ethereum.org': 'article, .post-content, main',
  'vitalik.eth.limo': '.post-content, article, main',
};

// RSS/Atom feed URLs for each source
export const RSS_FEEDS: Record<string, string> = {
  // Tier 1
  'blog.ethereum.org': 'https://blog.ethereum.org/feed.xml',
  'vitalik.eth.limo': 'https://vitalik.eth.limo/feed.xml',
  // Tier 2 — Community newsletters
  'medium.com/ethereum-cat-herders': 'https://medium.com/feed/ethereum-cat-herders',
  'christinedkim.substack.com': 'https://christinedkim.substack.com/feed',
  'ethereumweeklydigest.substack.com': 'https://ethereumweeklydigest.substack.com/feed',
  // Tier 5 — Client release Atom feeds
  'github.com/ethereum/go-ethereum': 'https://github.com/ethereum/go-ethereum/releases.atom',
  'github.com/NethermindEth/nethermind': 'https://github.com/NethermindEth/nethermind/releases.atom',
  'github.com/hyperledger/besu': 'https://github.com/hyperledger/besu/releases.atom',
  'github.com/paradigmxyz/reth': 'https://github.com/paradigmxyz/reth/releases.atom',
  'github.com/erigontech/erigon': 'https://github.com/erigontech/erigon/releases.atom',
  'github.com/sigp/lighthouse': 'https://github.com/sigp/lighthouse/releases.atom',
  'github.com/OffchainLabs/prysm': 'https://github.com/OffchainLabs/prysm/releases.atom',
  'github.com/ConsenSys/teku': 'https://github.com/ConsenSys/teku/releases.atom',
  'github.com/status-im/nimbus-eth2': 'https://github.com/status-im/nimbus-eth2/releases.atom',
  'github.com/ChainSafe/lodestar': 'https://github.com/ChainSafe/lodestar/releases.atom',
  // L2 node + spec releases (#78)
  'github.com/OffchainLabs/nitro': 'https://github.com/OffchainLabs/nitro/releases.atom',
  'github.com/ethereum-optimism/optimism': 'https://github.com/ethereum-optimism/optimism/releases.atom',
  'github.com/base/node': 'https://github.com/base/node/releases.atom',
  'github.com/matter-labs/zksync-era': 'https://github.com/matter-labs/zksync-era/releases.atom',
  'github.com/scroll-tech/scroll': 'https://github.com/scroll-tech/scroll/releases.atom',
  'github.com/Consensys/linea-monorepo': 'https://github.com/Consensys/linea-monorepo/releases.atom',
  'github.com/starkware-libs/cairo': 'https://github.com/starkware-libs/cairo/releases.atom',
  'github.com/ethereum/consensus-specs': 'https://github.com/ethereum/consensus-specs/releases.atom',
  'github.com/ethereum/execution-specs': 'https://github.com/ethereum/execution-specs/releases.atom',
  // Tier 11 — Developer tooling
  'github.com/foundry-rs/foundry': 'https://github.com/foundry-rs/foundry/releases.atom',
  // Tier 12 — Research & security blogs (RSS)
  'joncharbonneau.substack.com': 'https://joncharbonneau.substack.com/feed',
  'blog.trailofbits.com': 'https://blog.trailofbits.com/feed/',
  'www.openzeppelin.com': 'https://www.openzeppelin.com/news/rss.xml',
  // Tier 13 — Research, security & protocol blogs II
  'blog.sigmaprime.io': 'https://blog.sigmaprime.io/feeds/all.atom.xml',
  'blog.lido.fi': 'https://blog.lido.fi/rss/',
  'blog.chain.link': 'https://blog.chain.link/feed/',
  'medium.com/immunefi': 'https://medium.com/feed/immunefi',
  'offchain.medium.com': 'https://offchain.medium.com/feed',
  'www.theblock.co': 'https://www.theblock.co/rss.xml',
  // Tier 14 — Smart contract language releases
  'github.com/ethereum/solidity': 'https://github.com/ethereum/solidity/releases.atom',
  'github.com/vyperlang/vyper': 'https://github.com/vyperlang/vyper/releases.atom',
  // Tier 15 — L2 team blogs
  'medium.com/ethereum-optimism': 'https://medium.com/feed/ethereum-optimism',
  'blog.arbitrum.io': 'https://blog.arbitrum.io/rss/',
  'blog.matter-labs.io': 'https://blog.matter-labs.io/feed',
  'starkware.co': 'https://starkware.co/feed/',
  'medium.com/@polygonlabs': 'https://medium.com/feed/@polygonlabs',
  // Tier 16 — Research & developer blogs
  'dankradfeist.de': 'https://dankradfeist.de/feed.xml',
  'medium.com/@polynya': 'https://medium.com/feed/@polynya',
  'timbeiko.substack.com': 'https://timbeiko.substack.com/feed',
  'bankless.com': 'https://www.bankless.com/rss/feed',
  'paragraph.xyz/@devcon': 'https://paragraph.xyz/@devcon/feed',
  'medium.com/consensys-media': 'https://medium.com/feed/consensys-media',
  // Tier 17 — Security auditors & researchers
  'www.zellic.io': 'https://www.zellic.io/blog/rss.xml',
  'www.chainalysis.com': 'https://www.chainalysis.com/blog/feed/',
  'slowmist.medium.com': 'https://slowmist.medium.com/feed',
  'www.halborn.com': 'https://www.halborn.com/blog/feed.xml',
  'medium.com/dedaub': 'https://medium.com/feed/dedaub',
  'medium.com/consensys-diligence': 'https://medium.com/feed/consensys-diligence',
  'medium.com/cyfrin': 'https://medium.com/feed/cyfrin',
  'medium.com/@BlockSec': 'https://medium.com/feed/@BlockSec',
  // P1 high-signal sources with RSS
  'writings.flashbots.net': 'https://writings.flashbots.net/rss.xml',
  'samczsun.com': 'https://samczsun.com/rss/',
};

// Sources that need full article scraping (feeds with only excerpts)
const SCRAPE_SOURCES = new Set([
  'blog.ethereum.org',
  'vitalik.eth.limo',
]);

export class RssFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    const feedUrl = RSS_FEEDS[this.config.sourceId];
    if (!feedUrl) {
      logger.warn(`No RSS feed URL configured for ${this.config.sourceId}`);
      return [];
    }

    logger.debug(`Fetching RSS feed: ${feedUrl}`);

    const feed = await parser.parseURL(feedUrl);
    const results: FetchResult[] = [];

    const MAX_ITEMS_PER_FETCH = 30;
    let count = 0;

    for (const item of feed.items) {
      if (count >= MAX_ITEMS_PER_FETCH) break;

      const pubDate = item.pubDate
        ? new Date(item.pubDate)
        : item.isoDate
          ? new Date(item.isoDate)
          : null;
      if (!this.isAfterLastPoll(pubDate)) continue;

      let link = item.link;
      if (!link) continue;

      // Vitalik's RSS feed links to vitalik.ca which doesn't resolve
      if (link.includes('vitalik.ca')) {
        link = link.replace('https://vitalik.ca', 'https://vitalik.eth.limo');
      }

      // For sources that need scraping, fetch full article; otherwise use feed content
      let fullText: string | null;
      if (SCRAPE_SOURCES.has(this.config.sourceId)) {
        fullText = await this.scrapeArticle(link);
      } else {
        // Use content from feed (Substack, Medium, GitHub releases include full content)
        fullText = item.contentSnippet
          ?? item['content:encoded']
          ?? item.content
          ?? item.summary
          ?? null;
      }

      count++;

      results.push({
        sourceId: this.config.sourceId,
        canonicalUrl: link,
        rawTitle: item.title ?? null,
        rawText: fullText,
        rawMetadata: {
          guid: item.guid ?? item.id ?? null,
          author: item.creator ?? item['dc:creator'] ?? null,
          categories: item.categories ?? [],
        },
        publishedAt: pubDate,
      });
    }

    logger.info(`${this.config.sourceId}: ${results.length} new RSS items`);
    return results;
  }

  private async scrapeArticle(url: string): Promise<string | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        logger.warn(`Failed to scrape article ${url}: ${response.status}`);
        return null;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, nav, header, footer').remove();

      // Try source-specific selectors first, then fall back to generic
      const selector = CONTENT_SELECTORS[this.config.sourceId] ?? 'article, main, .content';
      let text = $(selector).first().text();

      if (!text || text.length < 100) {
        text = $('body').text();
      }

      return text.replace(/\s+/g, ' ').trim() || null;
    } catch (error) {
      logger.warn(`Error scraping ${url}:`, error);
      return null;
    }
  }
}
