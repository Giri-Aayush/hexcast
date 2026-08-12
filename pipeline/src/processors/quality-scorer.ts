import type { EngagementMetrics } from '@hexcast/shared';
import type { SummarySignals } from './summarizer.js';

/**
 * Source quality weights based on tier and signal reliability.
 * Range: 0.0 (low-trust aggregator) → 1.0 (primary protocol source).
 */
const SOURCE_QUALITY_WEIGHTS: Record<string, number> = {
  // Tier 1 — Core Protocol (primary sources, highest trust)
  'ethresear.ch': 1.0,
  'ethereum-magicians.org': 1.0,
  'github.com/ethereum/EIPs': 1.0,
  'github.com/ethereum/ERCs': 1.0,
  'github.com/ethereum/pm': 1.0,
  'forkcast.org': 0.95,
  'blog.ethereum.org': 1.0,
  'vitalik.eth.limo': 1.0,

  // Tier 2 — Community Intelligence
  'medium.com/ethereum-cat-herders': 0.9,
  'christinedkim.substack.com': 0.9,
  'ethereumweeklydigest.substack.com': 0.85,

  // Tier 3 — L2 Governance
  'gov.optimism.io': 0.8,
  'forum.arbitrum.foundation': 0.8,
  'forum.zknation.io': 0.75,
  'community.starknet.io': 0.75,
  'gov.uniswap.org': 0.8,

  // Tier 5 — Client Releases (official release notes)
  'github.com/ethereum/go-ethereum': 0.9,
  'github.com/NethermindEth/nethermind': 0.9,
  'github.com/hyperledger/besu': 0.9,
  'github.com/paradigmxyz/reth': 0.9,
  'github.com/erigontech/erigon': 0.9,
  'github.com/sigp/lighthouse': 0.9,
  'github.com/OffchainLabs/prysm': 0.9,
  'github.com/ConsenSys/teku': 0.9,
  'github.com/status-im/nimbus-eth2': 0.9,
  'github.com/ChainSafe/lodestar': 0.9,

  // Tier 6 — On-Chain Metrics
  'defillama.com/stablecoins': 0.7,
  'defillama.com/chains': 0.7,
  'defillama.com/dexs': 0.7,

  // Tier 7 — Crypto Social / Aggregators (needs quality filtering)
  'cryptopanic.com/trending': 0.35,
  'cryptopanic.com/hot': 0.4,
  'cryptopanic.com/rising': 0.3,
  'cryptocurrency.cv/news': 0.35,

  // Tier 8 — DeFi Protocol Governance
  'research.lido.fi': 0.8,
  'comp.xyz': 0.75,
  'gov.curve.finance': 0.75,
  'discuss.ens.domains': 0.8,
  'forum.eigenlayer.xyz': 0.75,
  'forum.thegraph.com': 0.7,
  'forum.safe.global': 0.7,
  'governance.aave.com': 0.8,
  'forum.sky.money': 0.75,

  // Tier 9 — L2 Governance
  'forum.scroll.io': 0.7,
  'forum.polygon.technology': 0.75,
  'community.linea.build': 0.7,
  'community.taiko.xyz': 0.7,

  // Tier 10 — MEV / PBS
  'collective.flashbots.net': 0.85,
  'github.com/flashbots/pm': 0.85,
  'github.com/flashbots/mev-boost-relay': 0.85,

  // Tier 11 — Standards & Tooling
  'github.com/ethereum/RIPs': 0.9,
  'github.com/eth-infinitism/account-abstraction': 0.85,
  'github.com/foundry-rs/foundry': 0.85,

  // Tier 12 — Research & Security Blogs
  'joncharbonneau.substack.com': 0.9,
  'blog.trailofbits.com': 0.95,
  'www.openzeppelin.com': 0.9,
  'www.nethermind.io': 0.85,

  // P1 — High-Signal Sources
  'rekt.news': 0.95,
  'paradigm.xyz': 0.95,
  'writings.flashbots.net': 0.9,
  'samczsun.com': 0.95,
  'hackmd.io/@timbeiko/acd': 0.9,
};

const DEFAULT_SOURCE_WEIGHT = 0.5;
const AUTO_SUPPRESS_THRESHOLD = 0.25;

interface QualityInput {
  sourceId: string;
  headline: string;
  summary: string;
  author: string | null;
  engagement: EngagementMetrics | null;
  /** Absent for cards written before generation signals were recorded. */
  signals?: SummarySignals;
}

/** The components behind a score, stored so a number can be explained later. */
export interface QualityBreakdown {
  score: number;
  sourceWeight: number;
  contentSignals: number;
  generation: number | null;
}

/**
 * Target band the summarizer aims for. Distance outside it is what "the model
 * struggled" looks like numerically.
 */
const TARGET_MIN_WORDS = 55;
const TARGET_MAX_WORDS = 60;

/**
 * How well the summary was actually generated, 0–1.
 *
 * This is the part the old formula was missing entirely. It had four existence
 * checks, two of which — headline longer than 10 chars, summary longer than 40 —
 * are true of every card that can reach the database, so 0.75 of the content
 * component was free and 55% of cards scored exactly 1.0. Nothing that varies
 * with whether the summary is any *good* was being measured.
 */
function scoreGeneration(signals: SummarySignals): number {
  // Retries used to carry 0.4 of this score. Under the honest-ceiling policy the model
  // lands first try essentially always — measured 100% — so `attempts` is close to a
  // constant and discriminates almost nothing. It also measures word-count compliance,
  // which is a formatting property rather than a factual one. Kept as a small signal
  // because 3 attempts still says something went wrong.
  const firstTry = signals.attempts <= 1 ? 1 : signals.attempts === 2 ? 0.6 : 0.3;

  // Entity preservation is the closest thing to ground truth we have, so it carries the
  // most weight. Proportional to how many identifiers the source actually had: losing 3
  // of 40 is a good summary of a dense document, losing 3 of 4 is a bad summary of a
  // simple one. The old flat 0.25-per-loss floored at zero scored those identically, and
  // scored 13 losses the same as 4.
  const entities = signals.totalEntities > 0 ? signals.entityPreservationRate : 1;

  // Only OVERSHOOT counts against a card now. A short summary is a property of a thin
  // source, not a defect — penalising it is what pushed the model to pad with invented
  // detail in the first place.
  const overshoot = Math.max(0, signals.wordCount - TARGET_MAX_WORDS);
  const length = Math.max(0, 1 - overshoot / 20);

  // Truncation cuts a sentence mid-thought, so it is a defect in its own right
  // rather than just a length miss.
  const truncationPenalty = signals.truncated ? 0.7 : 1;

  return (entities * 0.6 + firstTry * 0.2 + length * 0.2) * truncationPenalty;
}

/**
 * Compute a quality score (0.0 – 1.0) for a card.
 *
 * With generation signals:  sourceWeight * 0.3 + content * 0.2 + generation * 0.5
 * Without (legacy path):    sourceWeight * 0.4 + content * 0.6
 *
 * Generation carries the most weight because it is the only part that varies with
 * whether this particular summary came out well. Source weight says the source is
 * usually good; content signals say the fields are populated. Neither can tell a
 * clean first-try summary from one that needed three retries and still lost half
 * its identifiers.
 *
 * Content signals (0.0 – 1.0), unchanged so legacy scores stay comparable:
 *   - Headline exists and is substantial (> 10 chars): 0.35
 *   - Summary exists and is substantial (> 40 chars):  0.40
 *   - Author attribution present:                      0.15
 *   - Engagement data present:                         0.10
 */
export function scoreQuality(input: QualityInput): number {
  return scoreQualityBreakdown(input).score;
}

/** Same score, with its components, for storing next to the card. */
export function scoreQualityBreakdown(input: QualityInput): QualityBreakdown {
  const sourceWeight = SOURCE_QUALITY_WEIGHTS[input.sourceId] ?? DEFAULT_SOURCE_WEIGHT;

  let contentSignals = 0;

  // Headline quality
  if (input.headline && input.headline.length > 10) {
    contentSignals += 0.35;
  } else if (input.headline && input.headline.length > 0) {
    contentSignals += 0.15;
  }

  // Summary quality
  if (input.summary && input.summary.length > 40) {
    contentSignals += 0.40;
  } else if (input.summary && input.summary.length > 0) {
    contentSignals += 0.15;
  }

  // Author attribution
  if (input.author) {
    contentSignals += 0.15;
  }

  // Engagement data
  if (input.engagement && (input.engagement.likes || input.engagement.replies || input.engagement.views)) {
    contentSignals += 0.10;
  }

  if (!input.signals) {
    // Legacy weighting, kept so cards scored before signals existed are not
    // silently re-baselined against a formula they were never measured by.
    return { score: sourceWeight * 0.4 + contentSignals * 0.6, sourceWeight, contentSignals, generation: null };
  }

  const generation = scoreGeneration(input.signals);
  return {
    score: sourceWeight * 0.3 + contentSignals * 0.2 + generation * 0.5,
    sourceWeight,
    contentSignals,
    generation,
  };
}

/**
 * Should this card be auto-suppressed due to low quality?
 * Cards below the threshold get is_suspended = true.
 */
export function shouldAutoSuppress(score: number): boolean {
  return score < AUTO_SUPPRESS_THRESHOLD;
}
