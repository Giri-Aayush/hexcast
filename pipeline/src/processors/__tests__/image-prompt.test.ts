import { describe, it, expect } from 'vitest';
import { buildImagePrompt, scrubMotifs, CATEGORY_STYLES, MOTIF_PROMPT_EXAMPLES } from '../image-prompt.js';

describe('scrubMotifs', () => {
  it('accepts every phrase the extraction prompt teaches', () => {
    // The filter and the prompt must agree. They did not at first: the prompt demonstrated
    // "held tension" and "slow erosion" while the vocabulary had only "tension" and
    // "erosion", so the model was being taught to produce output that was silently thrown
    // away — and the symptom is "the filter rejects everything", which reads as a model
    // failure rather than an internal contradiction. This test is what stops it recurring
    // the next time someone adds an example.
    for (const example of MOTIF_PROMPT_EXAMPLES) {
      expect(scrubMotifs([example]), example).toEqual([example]);
    }
  });

  it('keeps abstract form and motion words', () => {
    expect(scrubMotifs(['fracture', 'fault line', 'held tension'])).toEqual([
      'fracture',
      'fault line',
      'held tension',
    ]);
  });

  it('drops a protocol name the reject list would never have contained', () => {
    // The whole reason this is an allow list. A reject list stops the names we thought of
    // and passes every one we did not — and a protocol that launched this morning is
    // exactly the case we cannot enumerate in advance.
    expect(scrubMotifs(['fracture', 'Uniswap liquidity', 'flowing curve'])).toEqual([
      'fracture',
      'flowing curve',
    ]);
  });

  it('drops anything containing a digit', () => {
    expect(scrubMotifs(['fracture', '3 layers', 'v2 cascade'])).toEqual(['fracture']);
  });

  it('drops named physical objects even though they sound visual', () => {
    // "hardware wallet", "exchange", "padlock" are depictable things. An image containing
    // one is asserting something about the story that no check downstream could catch.
    expect(scrubMotifs(['padlock', 'exchange floor', 'server rack', 'quiet threshold'])).toEqual([
      'quiet threshold',
    ]);
  });

  it('caps at three motifs', () => {
    expect(
      scrubMotifs(['fracture', 'flow', 'tension', 'balance', 'erosion']),
    ).toHaveLength(3);
  });

  it('drops duplicates and normalizes case', () => {
    expect(scrubMotifs(['Fracture', 'fracture', 'FLOW'])).toEqual(['fracture', 'flow']);
  });

  it('drops an overlong phrase', () => {
    // A five-word phrase is a sentence, and a sentence is where narrative sneaks back in.
    expect(scrubMotifs(['a slow and quiet erosion of order', 'fracture'])).toEqual(['fracture']);
  });

  it('returns nothing when every motif is rejected', () => {
    expect(scrubMotifs(['Ethereum', 'Lido staking', '$1.5B outflow'])).toEqual([]);
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
