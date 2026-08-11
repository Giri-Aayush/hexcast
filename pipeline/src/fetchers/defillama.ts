import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

// ── DefiLlama API types ────────────────────────────────────────────────

interface StablecoinEntry {
  id: string;
  name: string;
  symbol: string;
  circulating: { peggedUSD: number };
  circulatingPrevDay: { peggedUSD: number };
  circulatingPrevWeek: { peggedUSD: number };
  circulatingPrevMonth: { peggedUSD: number };
  chainCirculating: Record<string, { current: { peggedUSD: number } }>;
  chains: string[];
  price: number | null;
}

interface ChainTvlPoint {
  date: number; // Unix timestamp
  tvl: number;
}

interface DexProtocol {
  name: string;
  displayName: string;
  chains: string[];
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  totalAllTime: number | null;
  change_1d: number | null;
  change_7d: number | null;
  change_1m: number | null;
}

interface DexOverviewResponse {
  protocols: DexProtocol[];
  total24h: number | null;
  change_1d: number | null;
  change_7d: number | null;
}

// ── Configuration ──────────────────────────────────────────────────────

const STABLECOIN_THRESHOLDS = {
  minCirculating: 100_000_000, // $100M minimum to track
  dailyChangePct: 3, // >3% daily for >$1B stables
  weeklyChangePct: 10, // >10% weekly
  monthlyChangePct: 25, // >25% monthly
  largeCapThreshold: 1_000_000_000, // $1B = "large cap"
};

// Politeness gap between per-chain requests to api.llama.fi
const CHAIN_REQUEST_DELAY_MS = 200;

const TRACKED_CHAINS = [
  'Ethereum',
  'Arbitrum',
  'OP Mainnet',
  'Base',
  'Polygon',
  'BSC',
  'Solana',
  'Avalanche',
  'Blast',
  'Scroll',
  'zkSync Era',
  'Linea',
  'Starknet',
  'Mantle',
];

const CHAIN_TVL_THRESHOLDS = {
  dailyChangePct: 10, // >10% in 24h
  weeklyChangePct: 20, // >20% in 7d
};

const DEX_THRESHOLDS = {
  minDailyVolume: 10_000_000, // $10M minimum daily volume
  dailyChangePct: 100, // >100% daily change (volume is volatile)
  weeklyChangePct: 75, // >75% weekly change
};

// ── Helpers ────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function todayDateStr(): string {
  return new Date().toISOString().split('T')[0];
}

function signedPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// ── Top chain breakdown for stablecoins ────────────────────────────────

function topChains(
  chainCirculating: Record<string, { current: { peggedUSD: number } }>,
  limit = 3
): string {
  const entries = Object.entries(chainCirculating)
    .map(([chain, data]) => ({ chain, value: data.current.peggedUSD }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return entries.map((e) => `${e.chain}: ${formatUsd(e.value)}`).join(', ');
}

// ── Fetcher ────────────────────────────────────────────────────────────

export class DefiLlamaFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    switch (this.config.sourceId) {
      case 'defillama.com/stablecoins':
        return this.fetchStablecoins();
      case 'defillama.com/chains':
        return this.fetchChainTvl();
      case 'defillama.com/dexs':
        return this.fetchDexVolumes();
      default:
        logger.warn(`Unknown DefiLlama source: ${this.config.sourceId}`);
        return [];
    }
  }

  // ── Stablecoins ────────────────────────────────────────────────────

  private async fetchStablecoins(): Promise<FetchResult[]> {
    const res = await fetch(
      'https://stablecoins.llama.fi/stablecoins?includePrices=true'
    );
    if (!res.ok) {
      logger.error(`DefiLlama stablecoins API error: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as { peggedAssets: StablecoinEntry[] };
    const results: FetchResult[] = [];
    const dateStr = todayDateStr();

    for (const stable of data.peggedAssets) {
      const circulating = stable.circulating?.peggedUSD ?? 0;
      if (circulating < STABLECOIN_THRESHOLDS.minCirculating) continue;

      const prevDay = stable.circulatingPrevDay?.peggedUSD ?? 0;
      const prevWeek = stable.circulatingPrevWeek?.peggedUSD ?? 0;
      const prevMonth = stable.circulatingPrevMonth?.peggedUSD ?? 0;

      const dailyChange = pctChange(circulating, prevDay);
      const weeklyChange = pctChange(circulating, prevWeek);
      const monthlyChange = pctChange(circulating, prevMonth);

      // Threshold check
      const isSignificant =
        (circulating >= STABLECOIN_THRESHOLDS.largeCapThreshold &&
          Math.abs(dailyChange) > STABLECOIN_THRESHOLDS.dailyChangePct) ||
        Math.abs(weeklyChange) > STABLECOIN_THRESHOLDS.weeklyChangePct ||
        Math.abs(monthlyChange) > STABLECOIN_THRESHOLDS.monthlyChangePct;

      if (!isSignificant) continue;

      const direction = weeklyChange >= 0 ? 'Increases' : 'Decreases';
      const title = `${stable.name} (${stable.symbol}) Supply ${direction} to ${formatUsd(circulating)}`;

      const chains = topChains(stable.chainCirculating ?? {});
      const priceStr =
        stable.price != null ? `$${stable.price.toFixed(4)}` : 'N/A';

      const text = [
        `${stable.name} (${stable.symbol}) Stablecoin Metrics — ${dateStr}`,
        '',
        `Circulating Supply: ${formatUsd(circulating)}`,
        `24h Change: ${signedPct(dailyChange)} (from ${formatUsd(prevDay)})`,
        `7-day Change: ${signedPct(weeklyChange)} (from ${formatUsd(prevWeek)})`,
        `30-day Change: ${signedPct(monthlyChange)} (from ${formatUsd(prevMonth)})`,
        `Price: ${priceStr}`,
        '',
        `Top Chains: ${chains}`,
        '',
        `${stable.symbol} is deployed across ${stable.chains?.length ?? 0} chains.`,
      ].join('\n');

      results.push({
        sourceId: this.config.sourceId,
        canonicalUrl: `https://defillama.com/stablecoins?snapshot=${dateStr}&symbol=${stable.symbol.toLowerCase()}`,
        rawTitle: title,
        rawText: text,
        rawMetadata: {
          metric_type: 'stablecoin',
          symbol: stable.symbol,
          circulating,
          daily_change_pct: dailyChange,
          weekly_change_pct: weeklyChange,
          monthly_change_pct: monthlyChange,
          price: stable.price,
          chains_count: stable.chains?.length ?? 0,
        },
        publishedAt: new Date(),
      });
    }

    logger.info(
      `${this.config.sourceId}: ${results.length} significant stablecoin events`
    );
    return results;
  }

  // ── Chain TVL ──────────────────────────────────────────────────────

  private async fetchChainTvl(): Promise<FetchResult[]> {
    const results: FetchResult[] = [];
    const dateStr = todayDateStr();

    for (const chain of TRACKED_CHAINS) {
      try {
        // Add small delay to be polite to the API
        await delay(CHAIN_REQUEST_DELAY_MS);

        const res = await fetch(
          `https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`
        );
        if (!res.ok) {
          logger.debug(`Chain TVL API error for ${chain}: ${res.status}`);
          continue;
        }

        const data = (await res.json()) as ChainTvlPoint[];
        if (data.length < 8) continue;

        const latest = data[data.length - 1];
        const yesterday = data[data.length - 2];
        const weekAgo = data[data.length - 8];

        const dailyChange = pctChange(latest.tvl, yesterday.tvl);
        const weeklyChange = pctChange(latest.tvl, weekAgo.tvl);

        const isSignificant =
          Math.abs(dailyChange) > CHAIN_TVL_THRESHOLDS.dailyChangePct ||
          Math.abs(weeklyChange) > CHAIN_TVL_THRESHOLDS.weeklyChangePct;

        if (!isSignificant) continue;

        const direction = dailyChange >= 0 ? 'Rises' : 'Drops';
        const title = `${chain} TVL ${direction} to ${formatUsd(latest.tvl)}`;

        const text = [
          `${chain} Total Value Locked Report — ${dateStr}`,
          '',
          `Current TVL: ${formatUsd(latest.tvl)}`,
          `24h Change: ${signedPct(dailyChange)} (from ${formatUsd(yesterday.tvl)})`,
          `7-day Change: ${signedPct(weeklyChange)} (from ${formatUsd(weekAgo.tvl)})`,
          '',
          `${chain} TVL has ${Math.abs(dailyChange) > CHAIN_TVL_THRESHOLDS.dailyChangePct ? 'significantly ' : ''}changed in the past ${Math.abs(dailyChange) > CHAIN_TVL_THRESHOLDS.dailyChangePct ? '24 hours' : 'week'}, indicating ${dailyChange >= 0 ? 'increased capital inflows' : 'capital outflows'}.`,
        ].join('\n');

        results.push({
          sourceId: this.config.sourceId,
          canonicalUrl: `https://defillama.com/chain/${encodeURIComponent(chain)}?snapshot=${dateStr}`,
          rawTitle: title,
          rawText: text,
          rawMetadata: {
            metric_type: 'chain_tvl',
            chain,
            tvl: latest.tvl,
            daily_change_pct: dailyChange,
            weekly_change_pct: weeklyChange,
          },
          publishedAt: new Date(),
        });
      } catch (error) {
        logger.debug(`Failed to fetch chain TVL for ${chain}:`, error);
      }
    }

    logger.info(
      `${this.config.sourceId}: ${results.length} significant chain TVL events`
    );
    return results;
  }

  // ── DEX Volumes ────────────────────────────────────────────────────

  private async fetchDexVolumes(): Promise<FetchResult[]> {
    const res = await fetch(
      'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume'
    );
    if (!res.ok) {
      logger.error(`DefiLlama DEX API error: ${res.status}`);
      return [];
    }

    const data = (await res.json()) as DexOverviewResponse;
    const results: FetchResult[] = [];
    const dateStr = todayDateStr();

    for (const dex of data.protocols) {
      const dailyVol = dex.total24h ?? 0;
      if (dailyVol < DEX_THRESHOLDS.minDailyVolume) continue;

      const dailyChange = dex.change_1d ?? 0;
      const weeklyChange = dex.change_7d ?? 0;

      const isSignificant =
        Math.abs(dailyChange) > DEX_THRESHOLDS.dailyChangePct ||
        Math.abs(weeklyChange) > DEX_THRESHOLDS.weeklyChangePct;

      if (!isSignificant) continue;

      const direction = dailyChange >= 0 ? 'Surges' : 'Drops';
      const displayName = dex.displayName || dex.name;
      const title = `${displayName} Volume ${direction}: ${formatUsd(dailyVol)} in 24h`;

      const chainsStr = dex.chains.slice(0, 5).join(', ');
      const totalAllTime = dex.totalAllTime
        ? `All-time volume: ${formatUsd(dex.totalAllTime)}`
        : '';

      const text = [
        `${displayName} DEX Volume Report — ${dateStr}`,
        '',
        `24h Volume: ${formatUsd(dailyVol)}`,
        `24h Change: ${signedPct(dailyChange)}`,
        `7-day Volume: ${dex.total7d ? formatUsd(dex.total7d) : 'N/A'}`,
        `7-day Change: ${dex.change_7d != null ? signedPct(dex.change_7d) : 'N/A'}`,
        `30-day Volume: ${dex.total30d ? formatUsd(dex.total30d) : 'N/A'}`,
        `Monthly Change: ${dex.change_1m != null ? signedPct(dex.change_1m) : 'N/A'}`,
        totalAllTime,
        '',
        `Active on: ${chainsStr}${dex.chains.length > 5 ? ` and ${dex.chains.length - 5} more` : ''}`,
      ]
        .filter(Boolean)
        .join('\n');

      const slug = dex.name.toLowerCase().replace(/\s+/g, '-');
      results.push({
        sourceId: this.config.sourceId,
        canonicalUrl: `https://defillama.com/dexs?snapshot=${dateStr}&protocol=${slug}`,
        rawTitle: title,
        rawText: text,
        rawMetadata: {
          metric_type: 'dex_volume',
          protocol: dex.name,
          volume_24h: dailyVol,
          volume_7d: dex.total7d,
          daily_change_pct: dailyChange,
          weekly_change_pct: weeklyChange,
          chains: dex.chains,
        },
        publishedAt: new Date(),
      });
    }

    logger.info(
      `${this.config.sourceId}: ${results.length} significant DEX volume events`
    );
    return results;
  }
}
