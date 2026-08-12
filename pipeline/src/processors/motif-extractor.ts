import { logger } from '../utils/logger.js';
import { scrubMotifs, MOTIF_PROMPT_EXAMPLES } from './image-prompt.js';

/**
 * Abstract visual motifs for a card's cover art.
 *
 * Separate from stat extraction, though the two look alike and were nearly merged. They
 * fire on different conditions: stats need a summary with two or more figures, motifs need
 * a high-priority card. Merging them would have meant every SECURITY card whose summary
 * happened to carry no figures — about 40% of them — silently losing its motifs and
 * falling back to a generic image, which is a coupling bug wearing the costume of an
 * optimisation. The saving that justified merging was sized against every card; images run
 * on ~18% of them, so the extra call costs well under a cent a month.
 */

const SYSTEM_PROMPT = `You turn a news summary into abstract visual motifs for cover art.

Return a JSON array of 2-3 short phrases. Each phrase is 1-3 words describing FORM, MOTION,
TEXTURE or MOOD only.

Examples of the register: ${MOTIF_PROMPT_EXAMPLES.map((e) => `"${e}"`).join(', ')}.

HARD RULES:
- NEVER name a company, protocol, product, chain, token, person or place.
- NEVER include a number, figure or date.
- NEVER name a physical object with an identity: no wallet, exchange, coin, chart, server,
  lock, key, building, screen.
- Describe how the news FEELS as shape and movement, never what it depicts.

A story about a security breach becomes ["fracture", "fault line", "held tension"].
A story about a fee vote becomes ["balance", "weighed order", "quiet threshold"].

Output only the JSON array. No prose, no code fences.`;

function parsePhrases(raw: string): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

/**
 * Extract motifs, or an empty list.
 *
 * Empty is safe and expected: buildImagePrompt falls back to the category mood alone, so
 * the card still gets an on-theme image. Never throws — an image with a plainer prompt
 * beats no image, and both beat a failed card.
 *
 * The scrub happens here rather than at prompt-build time so the rejection is visible in
 * the logs. If a model starts leaking protocol names, the count dropping is the signal.
 */
export async function extractMotifs(
  summary: string,
  complete: (request: { system: string; user: string; maxTokens: number }) => Promise<string>,
): Promise<string[]> {
  let raw: string;
  try {
    raw = await complete({ system: SYSTEM_PROMPT, user: summary, maxTokens: 100 });
  } catch (error) {
    logger.warn(`Motif extraction failed, image will use category mood alone: ${String(error)}`);
    return [];
  }

  const proposed = parsePhrases(raw);
  const kept = scrubMotifs(proposed);

  if (proposed.length > 0 && kept.length === 0) {
    logger.warn(
      `All ${proposed.length} motifs rejected by the vocabulary filter: ${proposed.join(', ')}`,
    );
  } else if (kept.length < proposed.length) {
    const dropped = proposed.filter((p) => !kept.includes(p.trim().toLowerCase()));
    logger.debug(`Motifs dropped by the vocabulary filter: ${dropped.join(', ')}`);
  }

  return kept;
}
