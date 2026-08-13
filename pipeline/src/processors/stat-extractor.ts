import { logger } from '../utils/logger.js';
import { hasEnoughFigures } from './figures.js';

/**
 * The three-figure row on a card: "1.21M / ACCOUNTS", "71% / TO 4 CONTRACTS",
 * "2 / CLIENT PATCHES".
 *
 * `value` is displayed large and MUST appear verbatim in the summary. `label` is the small
 * caption underneath and is the model's own words, because "ACCOUNTS" is nowhere in a
 * sentence that says "1.21M smart accounts have been deployed".
 */
export interface Stat {
  value: string;
  label: string;
}

/** Two stats is a row; one is an orphan. Below this the whole row is dropped. */
const MIN_STATS = 2;
const MAX_STATS = 3;

/**
 * A caption, not a sentence. The row is three fixed-width columns, so an overlong label
 * either wraps into the next card or gets ellipsed into nonsense — and "TO 4 CONTRAC…"
 * is worse than showing nothing. Enforced rather than truncated, for the same reason.
 */
const MAX_LABEL_CHARS = 22;

const SYSTEM_PROMPT = `You extract the key figures from a news summary for a stat row.

Return a JSON array of at most ${MAX_STATS} objects, each {"value": "...", "label": "..."}.

RULES:
- "value" MUST be copied character-for-character from the summary. Never reformat, round,
  convert units, or add a symbol the summary does not have.
- Copy a range whole: "5-10%" is ONE value, never two.
- "label" is 1-3 words, max ${MAX_LABEL_CHARS} characters, describing what the figure counts.
- Pick figures a reader would want at a glance: amounts, counts, percentages, versions.
- Skip dates, times, years, and ordinals like "3rd" or "19th".
- If the summary has fewer than ${MIN_STATS} figures worth showing, return [].

Output only the JSON array. No prose, no code fences.`;

/**
 * Pull the first JSON array out of a response.
 *
 * Models wrap output in code fences, prefix it with "Here are the stats:", and reasoning
 * models emit a <think> block first. Finding the outermost brackets survives all three
 * without a separate sanitizing pass per provider quirk.
 */
function parseStatArray(raw: string): unknown[] | null {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keep only the pairs that survive checking, in the model's own order.
 *
 * The verbatim rule is the point of the whole feature. A summary is already a lossy
 * retelling of a source; a stat row that paraphrases the summary would be a second lossy
 * hop, and the figure shown in 32px type would be the least verified number on the card.
 * So a value that is not an exact substring of the summary is DROPPED, never corrected —
 * repairing it would mean guessing which number the model meant, which is inventing.
 */
export function validateStats(candidates: unknown[], summary: string): Stat[] {
  const kept: Stat[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (kept.length === MAX_STATS) break;
    if (typeof candidate !== 'object' || candidate === null) continue;

    const { value, label } = candidate as { value?: unknown; label?: unknown };
    if (typeof value !== 'string' || typeof label !== 'string') continue;

    const trimmedValue = value.trim();
    const trimmedLabel = label.trim();
    if (!trimmedValue || !trimmedLabel) continue;
    if (trimmedLabel.length > MAX_LABEL_CHARS) continue;
    if (!summary.includes(trimmedValue)) continue;
    // Two slots showing the same number is a wasted row, not two stats.
    if (seen.has(trimmedValue)) continue;

    seen.add(trimmedValue);
    kept.push({ value: trimmedValue, label: trimmedLabel });
  }

  return kept.length >= MIN_STATS ? kept : [];
}

/**
 * Extract the stat row for a summary, or null if it does not have one.
 *
 * Null is the ordinary case, not a failure: measured over 300 real cards, only ~60% carry
 * two or more figures at all, so the row is legitimately absent on roughly four cards in
 * ten and the card layout has to treat that as a normal state.
 *
 * Never throws. A card with no stat row is a card; a card that failed to save because its
 * decoration could not be computed is a bug. Every failure path returns null and logs.
 */
export async function extractStats(
  summary: string,
  /**
   * Runs one completion and returns its text. Kept this narrow on purpose: the caller owns
   * providers, failover and rate limiting, and this module owns what a stat is. Passing an
   * endpoint in would drag both concerns into every test of the validation rules.
   */
  complete: (request: { system: string; user: string; maxTokens: number }) => Promise<string>,
): Promise<Stat[] | null> {
  // Cheapest check first. Skipping the call on summaries that cannot produce a row is
  // what makes this feature cost cents rather than dollars — it is ~40% of all cards.
  if (!hasEnoughFigures(summary, MIN_STATS)) return null;

  let raw: string;
  try {
    raw = await complete({ system: SYSTEM_PROMPT, user: summary, maxTokens: 200 });
  } catch (error) {
    logger.warn(`Stat extraction call failed, card will have no stat row: ${String(error)}`);
    return null;
  }

  const candidates = parseStatArray(raw);
  if (!candidates) {
    logger.warn(`Stat extraction returned unparseable output: ${raw.slice(0, 120)}`);
    return null;
  }

  const stats = validateStats(candidates, summary);

  if (candidates.length > 0 && stats.length === 0) {
    // Worth its own line: the model found figures and every one failed the verbatim
    // check. That is the signature of a model reformatting values ("1.21M" -> "1,210,000")
    // rather than copying them, and it would otherwise look identical to a summary that
    // simply had no stats.
    logger.warn(`All ${candidates.length} extracted stats failed validation against the summary`);
  }

  return stats.length > 0 ? stats : null;
}
