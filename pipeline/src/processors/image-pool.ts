import type { Category } from '@hexcast/shared';
import { CATEGORY_STYLES } from './image-prompt.js';

/**
 * A reusable pool of cover art, one set per category, assigned to cards deterministically.
 *
 * Per-card generation costs ~$0.015 every time a card is written — about $5.85/month
 * forever at steady state — and it only covers cards where motif extraction succeeds. A
 * pool of ${POOL_SIZE} per category is 128 images for under $2 ONCE, covers 100% of cards
 * including the ones per-card generation would have missed, and costs nothing ongoing.
 *
 * The trade is that art is no longer specific to a story. Reuse across cards is fine, so the
 * only real cost is visible repetition, and that is a function of pool size:
 *
 *   same-category cards in one 10-card view   pool=8   pool=16
 *                                        3      34%      18%
 *                                        4      59%      33%
 *                                        5      79%      50%
 *
 * 8 would show a duplicate more often than not in a feed with four cards of one category,
 * which the dev corpus has. 16 halves it for one extra dollar, spent once. That is why the
 * pool is this size and not the smaller number the cost argument alone would suggest.
 *
 * The per-card motif path stays in the tree. This is the launch approach; story-specific art
 * is a later enhancement, not a deletion.
 */

export const POOL_SIZE = 16;

/** Where a pool image lives in the bucket. Not card-scoped — many cards share one object. */
export function poolPath(category: Category, index: number): string {
  return `pool/${category}/${index}.png`;
}

/**
 * Structural variety, cycled across a category's pool.
 *
 * Without these, 16 calls with one prompt give 16 samples of the same idea — different in
 * detail, alike in composition. There is no seed on this API, so identical prompts already
 * return different images; these make the differences structural rather than incidental.
 */
const COMPOSITIONS = [
  'a single horizontal band across the lower third',
  'a diagonal convergence meeting off-centre',
  'two overlapping fields with a soft boundary',
  'a narrow vertical seam near one edge',
  'concentric drift radiating from one side',
  'a stepped terrace of flat planes',
  'a wide gradient wash with one sharp edge',
  'scattered fragments settling toward the centre',
  'a long shallow curve rising left to right',
  'interlocking angular shapes, mostly negative space',
  'a dense cluster dissolving into open ground',
  'parallel strata with one interruption',
  'a single off-centre focal mass',
  'layered translucent veils',
  'a taut line under slight tension',
  'quiet asymmetry, weight to one corner',
];

/**
 * The prompt for one pool image.
 *
 * Category mood and accent only — no summary, no motifs, no headline. The pool cannot be
 * story-specific by construction, which also means it cannot misrepresent a story: the
 * sentiment-inversion problem that made a latency improvement look like a fracture is
 * impossible here, because no card's words reach the model.
 */
export function buildPoolPrompt(category: Category, index: number): string {
  const style = CATEGORY_STYLES[category];
  const composition = COMPOSITIONS[index % COMPOSITIONS.length];

  return (
    `Abstract editorial cover texture for a crypto news card. Mood: ${style.mood}. ` +
    `Composition: ${composition}. ` +
    `Risograph grain and soft ink-wash on warm neutral paper #e9e8e4. ` +
    `Single restrained accent ${style.accent}. ` +
    `No text, no letters, no numbers, no logos, no charts, no recognizable objects, no people. ` +
    `Flat, minimal, print-like, generous negative space. Wide 16:9 composition.`
  );
}

/**
 * Which pool image a card gets. Stable for the life of the card.
 *
 * A hash rather than a counter or a random pick, because the assignment has to survive being
 * recomputed: a backfill re-run, a second environment, or a card re-assigned after the pool
 * grows must all land on the same image, or the feed reshuffles under the reader for no
 * reason. FNV-1a because it is short, has no dependencies, and spreads UUID inputs evenly —
 * cryptographic strength is irrelevant for choosing a picture.
 */
export function poolIndexFor(cardId: string, poolSize = POOL_SIZE): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cardId.length; i++) {
    hash ^= cardId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % poolSize;
}
