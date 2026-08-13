import type { Category } from '@hexcast/shared';

/**
 * Turning a news story into an abstract image prompt without letting the story into it.
 *
 * The requirement is that the art feel related to the news. The danger is that a model
 * given a story about a hack draws a hack — a padlock, a hooded figure, a burning
 * exchange — which is editorializing in pictures, and worse, a picture can assert
 * something the card never said and no check can catch it the way checkInvention catches
 * a fabricated number.
 *
 * So the prompt gets MOTIFS: abstract words for form, motion, texture and mood, drawn from
 * the summary but stripped of everything identifying. A hack becomes "fracture, fault
 * line"; a fee vote becomes "balance, threshold". The story shapes the image; the story
 * never appears in it.
 */

/** Accents come from the badge colours in design-system.css, so art and badge agree. */
interface CategoryStyle {
  accent: string;
  mood: string;
}

const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  ANNOUNCEMENT: { accent: '#3f3f46', mood: 'measured announcement, calm authority, a clean horizon' },
  RESEARCH: { accent: '#4a5f96', mood: 'cryptographic discovery, interference and signal in noise' },
  EIP_ERC: { accent: '#1f4fa8', mood: 'formal specification, interlocking structure, precise geometry' },
  PROTOCOL_CALLS: { accent: '#16646e', mood: 'coordination and cadence, synchronized motion' },
  GOVERNANCE: { accent: '#6149b2', mood: 'deliberation and balance, weighed decisions, a ledger order' },
  UPGRADE: { accent: '#2c7a5c', mood: 'forward motion and renewal, a threshold crossed' },
  SECURITY: { accent: '#a3342c', mood: 'vigilance and fault lines, tension held in check' },
  METRICS: { accent: '#8a6516', mood: 'flows and magnitudes, the rhythm of rising and falling' },
};

/**
 * What a motif may NOT contain.
 *
 * This was an allow list of about 150 abstract words, chosen to fail closed: anything
 * unrecognised was dropped, so an unknown protocol name could never leak into an image
 * prompt. The reasoning was right about the risk and catastrophically wrong about the cost.
 * Measured on a live run, it rejected 24 of 24 motifs — a 0% pass rate — so every image was
 * falling back to category mood alone and the feature the user actually asked for, art that
 * relates to the story, did not exist. The rejected motifs were things like "severed
 * conduit", "lingering drag" and "stitched restart": precisely what was wanted.
 *
 * The fix is not a longer allow list. It is that THE ENTITIES WE MUST EXCLUDE ARE
 * ENUMERABLE, and the argument for failing closed rested on believing they were not:
 *
 *   1. A protocol or product name in THIS card appears capitalised in THIS summary, which
 *      the extractor already has. That is an exact, per-card check needing no global list.
 *   2. Names that appear uncapitalised or not at all are covered by a small static list of
 *      chains and tokens.
 *   3. What is left is the real remaining risk — not entities but DEPICTABLE THINGS. A model
 *      given "steady hand" draws a hand; given "grid of mirrors" it draws mirrors. Those are
 *      the two motifs out of 24 that should have been dropped, and a reject list drops
 *      exactly them.
 *
 * So the guard now removes what is dangerous rather than admitting only what is familiar.
 */

/**
 * Things a model renders as a recognisable object. Body parts and named artifacts only —
 * NOT textural nouns like seam, conduit or horizon, which read as abstract shape.
 */
const DEPICTABLE = new Set([
  // people
  'hand', 'hands', 'face', 'faces', 'eye', 'eyes', 'head', 'body', 'finger', 'fingers',
  'arm', 'arms', 'leg', 'foot', 'figure', 'person', 'people', 'crowd', 'man', 'woman',
  'child', 'children', 'silhouette', 'portrait',
  // artifacts
  'wallet', 'purse', 'coin', 'coins', 'banknote', 'cash', 'chart', 'charts', 'graph',
  'diagram', 'server', 'servers', 'computer', 'laptop', 'phone', 'screen', 'monitor',
  'keyboard', 'lock', 'padlock', 'key', 'keys', 'door', 'gate', 'window', 'building',
  'tower', 'city', 'bridge', 'road', 'car', 'ship', 'rocket', 'mirror', 'mirrors',
  'clock', 'watch', 'book', 'page', 'map', 'flag', 'shield', 'sword', 'hammer', 'scales',
  'chain', 'chains', 'brick', 'bricks', 'vault', 'safe', 'box', 'crate',
]);

/**
 * Chains, tokens and organisations that might appear uncapitalised, or be alluded to
 * without appearing in the summary at all. Deliberately short: rule 1 above catches
 * anything actually named in the card, so this only has to cover the well-known names a
 * model might reach for unprompted.
 */
const KNOWN_ENTITIES = new Set([
  'ethereum', 'eth', 'bitcoin', 'btc', 'solana', 'sol', 'arbitrum', 'optimism', 'base',
  'polygon', 'starknet', 'zksync', 'scroll', 'linea', 'uniswap', 'aave', 'lido', 'curve',
  'compound', 'maker', 'ens', 'safe', 'flashbots', 'paradigm', 'coinbase', 'binance',
  'tether', 'usdt', 'usdc', 'dai', 'nethermind', 'geth', 'besu', 'erigon', 'reth',
  'prysm', 'lighthouse', 'teku', 'nimbus', 'lodestar', 'metamask', 'opensea',
]);

/**
 * The phrases the extraction prompt shows the model. Asserted by a test to survive
 * scrubMotifs — if an example is rejected, the model is being taught to produce output we
 * throw away, and the symptom reads as "the model is failing" rather than "the filter and
 * the prompt disagree". That is not hypothetical: the previous allow list rejected its own
 * prompt's examples until a test pinned them together.
 */
export const MOTIF_PROMPT_EXAMPLES = [
  'fracture',
  'fault line',
  'slow erosion',
  'converging flow',
  'held tension',
  'layered sediment',
  'quiet threshold',
  'balance',
  'weighed order',
];

const MAX_MOTIF_WORDS = 4;
const MAX_MOTIFS = 3;

/**
 * Capitalised words in the summary, lowercased.
 *
 * A sentence-initial capital is not a proper noun, so the first word of each sentence is
 * skipped — otherwise "Faster fault merging" would be rejected because the summary happened
 * to open with "Faster". That distinction is why the position matters and why a blanket
 * capitalisation rule was never going to work on its own.
 */
function properNounsIn(summary: string): Set<string> {
  const found = new Set<string>();
  for (const sentence of summary.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/);
    for (const [index, word] of words.entries()) {
      const bare = word.replace(/[^A-Za-z0-9.-]/g, '');
      if (index === 0 || !bare) continue;
      if (/^[A-Z]/.test(bare)) found.add(bare.toLowerCase());
    }
  }
  return found;
}

/**
 * Keep the motifs that carry no identity and depict no object.
 *
 * `summary` is optional so buildImagePrompt can apply the structural rules as a second
 * layer without needing the card text. Pass it wherever it is available — the per-card
 * proper-noun check is the strongest of the rules and the only one that adapts to a
 * protocol nobody has heard of yet.
 */
export function scrubMotifs(motifs: string[], summary = ''): string[] {
  const forbidden = properNounsIn(summary);
  const kept: string[] = [];

  for (const motif of motifs) {
    const phrase = motif.trim().toLowerCase();
    if (!phrase || /\d/.test(phrase)) continue;

    const words = phrase.split(/[\s,-]+/).filter(Boolean);
    if (words.length === 0 || words.length > MAX_MOTIF_WORDS) continue;
    if (words.some((w) => DEPICTABLE.has(w))) continue;
    if (words.some((w) => KNOWN_ENTITIES.has(w))) continue;
    if (words.some((w) => forbidden.has(w))) continue;
    if (kept.includes(phrase)) continue;

    kept.push(phrase);
    if (kept.length === MAX_MOTIFS) break;
  }

  return kept;
}

/**
 * Build the image prompt.
 *
 * Belt and braces on purpose. The motifs are already scrubbed to an abstract vocabulary,
 * and the prompt STILL forbids text, logos, objects and people — so even a motif that got
 * through cannot easily become a literal scene. Two independent guards, because the
 * failure they prevent is the kind that ships silently: nobody reviews 300 images.
 */
export function buildImagePrompt(category: Category, motifs: string[]): string {
  const style = CATEGORY_STYLES[category];
  const scrubbed = scrubMotifs(motifs);

  // Category mood alone is the fallback. It never fails, so an image is never blocked on
  // motif extraction going wrong — the card just gets a plainer, on-theme picture.
  const subject = scrubbed.length > 0 ? `${style.mood}; ${scrubbed.join(', ')}` : style.mood;

  return (
    `Abstract editorial cover texture for a crypto news card. Mood: ${subject}. ` +
    `Risograph grain and soft ink-wash on warm neutral paper #e9e8e4. ` +
    `Single restrained accent ${style.accent}. ` +
    `No text, no letters, no numbers, no logos, no charts, no recognizable objects, no people. ` +
    `Flat, minimal, print-like, generous negative space. Wide 16:9 composition.`
  );
}

export { CATEGORY_STYLES };
