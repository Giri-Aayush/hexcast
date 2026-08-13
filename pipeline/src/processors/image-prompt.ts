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
 * The words a motif is allowed to be built from.
 *
 * An ALLOW list, not a reject list, and that is the whole safety argument. A reject list
 * fails open: it stops the protocol names we thought of and passes every one we did not,
 * and the names we cannot enumerate — a protocol launched this morning — are exactly the
 * case that matters. An allow list fails closed. Anything unrecognised is dropped, so the
 * worst outcome is a plainer image rather than a leaked entity.
 *
 * Everything here describes form, motion, texture or mood. Nothing here can name a thing
 * in the world.
 */
const MOTIF_VOCABULARY = new Set([
  // form and structure
  'fracture', 'fault', 'line', 'lattice', 'grid', 'mesh', 'seam', 'fissure', 'crack',
  'layer', 'strata', 'sediment', 'band', 'field', 'plane', 'edge', 'boundary', 'threshold',
  'frame', 'scaffold', 'column', 'arc', 'curve', 'spiral', 'orbit', 'ring', 'node',
  'branch', 'root', 'web', 'weave', 'knot', 'chain', 'link', 'block', 'facet', 'prism',
  // motion and change
  'flow', 'drift', 'cascade', 'surge', 'swell', 'ripple', 'wave', 'pulse', 'rhythm',
  'convergence', 'divergence', 'expansion', 'contraction', 'ascent', 'descent', 'rise',
  'fall', 'shift', 'passage', 'crossing', 'transition', 'emergence', 'dissolution',
  'erosion', 'accretion', 'momentum', 'cadence', 'oscillation', 'settling', 'gathering',
  // texture and light
  'grain', 'noise', 'static', 'interference', 'signal', 'shadow', 'light', 'glow',
  'haze', 'mist', 'blur', 'wash', 'stain', 'bleed', 'grit', 'smooth', 'rough', 'soft',
  'sharp', 'dense', 'sparse', 'translucent', 'opaque', 'depth', 'surface',
  // mood and force
  'tension', 'balance', 'weight', 'pressure', 'stillness', 'quiet', 'restraint',
  'vigilance', 'caution', 'resolve', 'order', 'disorder', 'fragility', 'stability',
  'symmetry', 'asymmetry', 'containment', 'release', 'alignment', 'fragment',
  // manner: how a form or motion behaves. No modifier here can name a thing.
  // These exist because the extraction prompt TEACHES phrases like "held tension" and
  // "slow erosion" — an allow list that rejects the vocabulary its own prompt demonstrates
  // drops everything and looks like a model failure. MOTIF_PROMPT_EXAMPLES below is
  // checked against this set by a test so the two cannot drift apart again.
  'held', 'slow', 'fast', 'quiet', 'loud', 'deep', 'shallow', 'wide', 'narrow', 'thin',
  'thick', 'faint', 'bright', 'dark', 'warm', 'cool', 'still', 'restless', 'steady',
  'sudden', 'gradual', 'partial', 'broken', 'whole', 'layered', 'weighed', 'measured',
  'converging', 'diverging', 'rising', 'falling', 'flowing', 'settling', 'gathering',
  'spreading', 'receding', 'fracturing', 'shifting', 'breach', 'drift', 'lift',

  // connective words that carry no identity
  'and', 'of', 'in', 'a', 'an', 'the', 'into', 'through', 'across', 'against', 'under',
]);

/**
 * The phrases the extraction prompt shows the model. Exported so a test can assert every
 * one survives scrubMotifs — if a prompt example is not in the vocabulary, the model is
 * being taught to produce output we silently throw away, and the symptom is "the filter
 * rejects everything" with no obvious cause.
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

/**
 * Keep a motif only if every word in it is allowed.
 *
 * Also drops anything with a digit, which the vocabulary would already catch — kept as an
 * explicit rule because "no numbers in the image" is a stated requirement and a reader of
 * this code should see it enforced rather than infer it from a word list.
 */
export function scrubMotifs(motifs: string[]): string[] {
  const kept: string[] = [];

  for (const motif of motifs) {
    const phrase = motif.trim().toLowerCase();
    if (!phrase || /\d/.test(phrase)) continue;

    const words = phrase.split(/[\s,-]+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) continue;
    if (!words.every((word) => MOTIF_VOCABULARY.has(word))) continue;
    if (kept.includes(phrase)) continue;

    kept.push(phrase);
    if (kept.length === 3) break;
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
