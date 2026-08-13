import { describe, it, expect } from 'vitest';
import type { Category } from '@hexcast/shared';
import { POOL_SIZE, poolPath, buildPoolPrompt, poolIndexFor } from '../image-pool.js';
import { CATEGORY_STYLES } from '../image-prompt.js';

const CATEGORIES = Object.keys(CATEGORY_STYLES) as Category[];

describe('poolIndexFor', () => {
  it('is stable for the same card', () => {
    // The whole point of hashing rather than counting or randomising: a backfill re-run, a
    // second environment, or a reassignment after the pool changes must all land on the same
    // image, or the feed reshuffles under the reader for no reason.
    const id = '7819d08f-bff1-4508-a632-b62581de10f2';

    expect(poolIndexFor(id)).toBe(poolIndexFor(id));
  });

  it('stays inside the pool', () => {
    for (let i = 0; i < 500; i++) {
      const index = poolIndexFor(`card-${i}-${i * 7919}`);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(POOL_SIZE);
    }
  });

  it('spreads real UUIDs across the pool rather than clumping', () => {
    // A hash that bunched would defeat the point — a bigger pool only reduces repetition if
    // the assignment actually uses all of it. Checks every slot gets hit and none dominates.
    const ids = Array.from({ length: 1600 }, (_, i) =>
      `${i.toString(16).padStart(8, '0')}-bff1-4508-a632-b62581de${(i % 97).toString(16).padStart(4, '0')}`,
    );
    const counts = new Array(POOL_SIZE).fill(0);
    for (const id of ids) counts[poolIndexFor(id)]++;

    const expected = ids.length / POOL_SIZE;
    expect(Math.min(...counts)).toBeGreaterThan(expected * 0.5);
    expect(Math.max(...counts)).toBeLessThan(expected * 1.7);
  });

  it('honours a smaller pool when a category is short of images', () => {
    // Assignment indexes only into images that exist, so a partly-generated category must
    // stay in range instead of pointing at a missing object — which would 404 and render as
    // the dither fallback, indistinguishable from never being assigned.
    for (let i = 0; i < 200; i++) {
      expect(poolIndexFor(`c-${i}`, 3)).toBeLessThan(3);
    }
  });
});

describe('poolPath', () => {
  it('is category-scoped and not card-scoped', () => {
    // Many cards share one object; a card-scoped path would defeat the reuse the pool exists
    // for and multiply storage by the number of cards.
    expect(poolPath('UPGRADE', 0)).toBe('pool/UPGRADE/0.png');
    expect(poolPath('SECURITY', 15)).toBe('pool/SECURITY/15.png');
  });
});

describe('buildPoolPrompt', () => {
  it('carries the category accent and mood', () => {
    for (const category of CATEGORIES) {
      const prompt = buildPoolPrompt(category, 0);
      expect(prompt, category).toContain(CATEGORY_STYLES[category].accent);
      expect(prompt, category).toContain(CATEGORY_STYLES[category].mood);
    }
  });

  it('varies composition across the pool', () => {
    // Without this, sixteen calls on one prompt give sixteen samples of the same idea:
    // different in detail, alike in shape. The variation has to be structural.
    const prompts = new Set(
      Array.from({ length: POOL_SIZE }, (_, i) => buildPoolPrompt('UPGRADE', i)),
    );

    expect(prompts.size).toBe(POOL_SIZE);
  });

  it('still forbids text, objects and people', () => {
    const prompt = buildPoolPrompt('SECURITY', 3);

    expect(prompt).toContain('No text, no letters, no numbers');
    expect(prompt).toContain('no recognizable objects, no people');
  });

  it('cannot contain a story, because it never receives one', () => {
    // The structural upside of the pool: with no card text in the prompt, the
    // sentiment-inversion bug that drew a latency improvement as a fracture is impossible.
    const prompt = buildPoolPrompt('UPGRADE', 0);

    expect(prompt).not.toMatch(/fault|latency|reth|v\d/i);
  });
});
