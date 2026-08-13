import { describe, it, expect } from 'vitest';
import { buildImagePrompt, scrubMotifs, CATEGORY_STYLES, MOTIF_PROMPT_EXAMPLES } from '../image-prompt.js';

/**
 * Every motif the live dev run actually produced. The old allow list rejected all 24, a 0%
 * pass rate, so every image fell back to category mood and the story-related art the feature
 * exists for did not happen. Two of these SHOULD be dropped and the rest kept.
 */
const OBSERVED_MOTIFS = [
  'severed conduit', 'clear horizon', 'lingering drag', 'compressed wait',
  'stitched restart', 'patched seam', 'quiet repair', 'lightened load',
  'pre-warmed flow', 'layered checkpoint', 'faster fault merging', 'checked integrity',
  'quiet paranoia', 'hardened seam', 'drained pocket', 'quiet patch',
  'patchwork tension', 'shrink threshold', 'clean seam', 'scaling strain',
  'shifted weight', 'layered capacity',
  // the two that must not survive
  'steady hand', 'grid of mirrors',
];

describe('scrubMotifs', () => {
  it('keeps the abstract motifs the model really produces', () => {
    // The regression that matters. Each of these was rejected by the allow list and each is
    // exactly what the contract asked for: abstract, no proper noun, no figure, no object.
    for (const motif of OBSERVED_MOTIFS.slice(0, 22)) {
      expect(scrubMotifs([motif]), motif).toEqual([motif]);
    }
  });

  it('drops motifs naming something a model would draw literally', () => {
    // A hand and a mirror are things, not textures. These are the only two of the 24
    // observed motifs worth losing, and the reject list loses exactly them.
    expect(scrubMotifs(['steady hand'])).toEqual([]);
    expect(scrubMotifs(['grid of mirrors'])).toEqual([]);
    expect(scrubMotifs(['locked vault', 'coin stack', 'server rack'])).toEqual([]);
  });

  it('drops a proper noun taken from the summary it was extracted from', () => {
    // The per-card rule, and the reason a reject list is now safe: the entity we must avoid
    // is named in the card's own text, so no global list has to anticipate it. Works for a
    // protocol that launched this morning.
    const summary = 'Nethermind 1.39.3 patches an ABI regression affecting Blorptron nodes.';

    expect(scrubMotifs(['nethermind seam', 'blorptron drift', 'quiet patch'], summary)).toEqual([
      'quiet patch',
    ]);
  });

  it('does not reject a motif because a sentence happened to start with that word', () => {
    // Position matters. A blanket capitalisation rule would drop "faster fault merging"
    // whenever a summary opened with "Faster", which is why the first word of each sentence
    // is skipped.
    const summary = 'Faster block times ship in the upgrade. Scaling continues.';

    expect(scrubMotifs(['faster fault merging'], summary)).toEqual(['faster fault merging']);
  });

  it('drops well-known chains and tokens even when absent from the summary', () => {
    expect(scrubMotifs(['ethereum flow', 'bitcoin drift', 'quiet seam'], 'No names here.')).toEqual([
      'quiet seam',
    ]);
  });

  it('drops anything containing a digit', () => {
    expect(scrubMotifs(['fracture', '3 layers', 'v2 cascade'])).toEqual(['fracture']);
  });

  it('caps at three motifs', () => {
    expect(scrubMotifs(['fracture', 'flow', 'tension', 'balance', 'erosion'])).toHaveLength(3);
  });

  it('drops duplicates and normalizes case', () => {
    expect(scrubMotifs(['Fracture', 'fracture', 'FLOW'])).toEqual(['fracture', 'flow']);
  });

  it('drops an overlong phrase', () => {
    // Five words is a sentence, and a sentence is where narrative sneaks back in.
    expect(scrubMotifs(['a slow and quiet erosion of order', 'fracture'])).toEqual(['fracture']);
  });

  it('accepts every phrase the extraction prompt teaches', () => {
    // The prompt and the filter must agree. They did not under the allow list — it
    // demonstrated "held tension" while the vocabulary had only "tension" — so the model was
    // being trained to produce output that was silently discarded.
    for (const example of MOTIF_PROMPT_EXAMPLES) {
      expect(scrubMotifs([example]), example).toEqual([example]);
    }
  });
});

describe('buildImagePrompt', () => {
  it('includes the category accent and mood', () => {
    const prompt = buildImagePrompt('SECURITY', []);

    expect(prompt).toContain(CATEGORY_STYLES.SECURITY.accent);
    expect(prompt).toContain(CATEGORY_STYLES.SECURITY.mood);
  });

  it('always forbids text, objects and people, even with motifs', () => {
    // Belt and braces. The motifs are already scrubbed; the prompt still refuses a literal
    // scene, because nobody reviews 300 images and a silent failure ships.
    const prompt = buildImagePrompt('SECURITY', ['fracture', 'fault line']);

    expect(prompt).toContain('No text, no letters, no numbers');
    expect(prompt).toContain('no recognizable objects, no people');
  });

  it('falls back to the category mood alone when no motif survives', () => {
    const prompt = buildImagePrompt('UPGRADE', ['Nethermind client', '4.2%']);

    expect(prompt).toContain(CATEGORY_STYLES.UPGRADE.mood);
    expect(prompt).not.toContain('Nethermind');
    expect(prompt).not.toContain('4.2%');
  });

  it('never contains the summary text', () => {
    // The structural guarantee the whole design rests on: the model cannot depict an event
    // it was never told about.
    const prompt = buildImagePrompt('SECURITY', ['fracture']);

    expect(prompt).not.toMatch(/exploit|drained|attacker|vulnerability/i);
  });

  it('has a style for every category', () => {
    // A missing entry would render `undefined` into the prompt and produce a grey image
    // nobody would trace back to a map.
    for (const [category, style] of Object.entries(CATEGORY_STYLES)) {
      expect(style.accent, category).toMatch(/^#[0-9a-f]{6}$/i);
      expect(style.mood.length, category).toBeGreaterThan(10);
    }
  });
});
