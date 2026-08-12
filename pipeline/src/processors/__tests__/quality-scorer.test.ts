import { describe, it, expect } from 'vitest';
import { scoreQuality, scoreQualityBreakdown, shouldAutoSuppress } from '../quality-scorer.js';

describe('scoreQuality', () => {
  it('returns 1.0 for tier-1 source with full content signals', () => {
    const score = scoreQuality({
      sourceId: 'ethresear.ch',
      headline: 'A substantial headline here',
      summary: 'A summary that is definitely longer than forty characters in total.',
      author: 'vitalik',
      engagement: { likes: 10, replies: 5, views: 100 },
    });
    // 1.0 * 0.4 + (0.35 + 0.40 + 0.15 + 0.10) * 0.6 = 0.4 + 0.6 = 1.0
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('returns 0.8 for unknown source with full content signals', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: 'A substantial headline here',
      summary: 'A summary that is definitely longer than forty characters in total.',
      author: 'someone',
      engagement: { likes: 1 },
    });
    // 0.5 * 0.4 + 1.0 * 0.6 = 0.2 + 0.6 = 0.8
    expect(score).toBeCloseTo(0.8, 5);
  });

  it('returns 0.2 for unknown source with no content signals', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.0 * 0.6 = 0.2
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('adds 0.35 to content signals for headline > 10 chars', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: 'Long headline text',
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.35 * 0.6 = 0.2 + 0.21 = 0.41
    expect(score).toBeCloseTo(0.41, 5);
  });

  it('adds 0.15 to content signals for headline 1-10 chars', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: 'Short',
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.15 * 0.6 = 0.2 + 0.09 = 0.29
    expect(score).toBeCloseTo(0.29, 5);
  });

  it('adds 0 to content signals for empty headline', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.0 * 0.6 = 0.2
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('adds 0.40 to content signals for summary > 40 chars', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: 'This is a long summary that exceeds forty characters easily.',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.40 * 0.6 = 0.2 + 0.24 = 0.44
    expect(score).toBeCloseTo(0.44, 5);
  });

  it('adds 0.15 to content signals for summary 1-40 chars', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: 'Short summary',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.15 * 0.6 = 0.2 + 0.09 = 0.29
    expect(score).toBeCloseTo(0.29, 5);
  });

  it('adds 0.15 to content signals when author is present', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: 'vitalik',
      engagement: null,
    });
    // 0.5 * 0.4 + 0.15 * 0.6 = 0.2 + 0.09 = 0.29
    expect(score).toBeCloseTo(0.29, 5);
  });

  it('adds 0.10 to content signals when engagement has likes', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: { likes: 5 },
    });
    // 0.5 * 0.4 + 0.10 * 0.6 = 0.2 + 0.06 = 0.26
    expect(score).toBeCloseTo(0.26, 5);
  });

  it('adds 0 for null engagement', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.0 * 0.6 = 0.2
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('adds 0 for engagement with all zeros', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: { likes: 0, replies: 0, views: 0 },
    });
    // 0.5 * 0.4 + 0.0 * 0.6 = 0.2
    // The code checks `likes || replies || views` which is falsy when all are 0
    expect(score).toBeCloseTo(0.2, 5);
  });

  it('adds 0.10 for engagement with only views: 1', () => {
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: '',
      author: null,
      engagement: { likes: 0, replies: 0, views: 1 },
    });
    // 0.5 * 0.4 + 0.10 * 0.6 = 0.2 + 0.06 = 0.26
    expect(score).toBeCloseTo(0.26, 5);
  });

  it('gives 0.35 headline bonus for a very long headline (1000 chars)', () => {
    const longHeadline = 'A'.repeat(1000);
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: longHeadline,
      summary: '',
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.35 * 0.6 = 0.2 + 0.21 = 0.41
    expect(score).toBeCloseTo(0.41, 5);
  });

  it('gives 0.40 summary bonus for a very long summary (5000 chars)', () => {
    const longSummary = 'B'.repeat(5000);
    const score = scoreQuality({
      sourceId: 'unknown-source.com',
      headline: '',
      summary: longSummary,
      author: null,
      engagement: null,
    });
    // 0.5 * 0.4 + 0.40 * 0.6 = 0.2 + 0.24 = 0.44
    expect(score).toBeCloseTo(0.44, 5);
  });
});

describe('shouldAutoSuppress', () => {
  it('returns true for score below 0.25', () => {
    expect(shouldAutoSuppress(0.24)).toBe(true);
  });

  it('returns false for score equal to 0.25', () => {
    expect(shouldAutoSuppress(0.25)).toBe(false);
  });

  it('returns false for score above 0.25', () => {
    expect(shouldAutoSuppress(0.5)).toBe(false);
  });
});

describe('generation signals', () => {
  const base = {
    sourceId: 'ethresear.ch', // weight 1.0, so source weight can't mask the effect
    headline: 'A Headline Long Enough To Pass',
    summary: 'x'.repeat(200),
    author: 'someone',
    engagement: null,
  };

  const clean = {
    attempts: 1,
    wordCount: 58,
    truncated: false,
    entitiesPreserved: true,
    missingEntities: [] as string[],
    entityPreservationRate: 1,
    totalEntities: 8,
  };

  it('scores a clean first-try summary above a struggling one', () => {
    const good = scoreQuality({ ...base, signals: clean });
    const bad = scoreQuality({
      ...base,
      signals: {
        attempts: 3,
        wordCount: 45,
        truncated: true,
        entitiesPreserved: false,
        missingEntities: ['EIP-8037', 'v2.4.1', '71%'],
        entityPreservationRate: 0.25, // kept 1 of 4
        totalEntities: 4,
      },
    });

    expect(good).toBeGreaterThan(bad);
    // The old formula gave both of these exactly 1.0 — identical fields, identical
    // source. Spread is the entire point of the rework.
    expect(good - bad).toBeGreaterThan(0.3);
  });

  it('scores losses in proportion to what the source contained', () => {
    // The heart of #32: the old formula was 0.25 per loss floored at zero, so losing 3
    // of 40 identifiers scored the same as losing 3 of 4 — and 13 losses scored the same
    // as 4. Proportional scoring separates a good summary of a dense document from a bad
    // summary of a simple one.
    const dense = scoreQuality({
      ...base,
      signals: { ...clean, entitiesPreserved: false, entityPreservationRate: 37 / 40, totalEntities: 40, missingEntities: ['a', 'b', 'c'] },
    });
    const simple = scoreQuality({
      ...base,
      signals: { ...clean, entitiesPreserved: false, entityPreservationRate: 1 / 4, totalEntities: 4, missingEntities: ['a', 'b', 'c'] },
    });

    // Same three identifiers lost, very different summaries.
    expect(dense).toBeGreaterThan(simple);
  });

  it('penalises each lost identifier rather than just failing the check', () => {
    const one = scoreQuality({
      ...base,
      signals: { ...clean, entitiesPreserved: false, missingEntities: ['EIP-8037'], entityPreservationRate: 0.75, totalEntities: 4 },
    });
    const three = scoreQuality({
      ...base,
      signals: { ...clean, entitiesPreserved: false, missingEntities: ['EIP-8037', '71%', 'v2.4.1'], entityPreservationRate: 0.25, totalEntities: 4 },
    });

    expect(one).toBeGreaterThan(three);
  });

  it('penalises truncation on its own', () => {
    const whole = scoreQuality({ ...base, signals: clean });
    const cut = scoreQuality({ ...base, signals: { ...clean, truncated: true } });

    expect(cut).toBeLessThan(whole);
  });

  it('keeps the legacy formula when signals are absent', () => {
    // Cards written before signals existed must not be re-baselined against a
    // formula they were never measured by.
    const legacy = scoreQualityBreakdown(base);

    expect(legacy.generation).toBeNull();
    expect(legacy.score).toBeCloseTo(1.0 * 0.4 + 0.9 * 0.6, 5);
  });

  it('makes auto-suppression reachable, which it was not before', () => {
    // Old floor for any card that could exist was sourceWeight*0.4 + 0.45, so even
    // a weight-0 source scored 0.45 against a 0.25 cut and nothing could ever be
    // suppressed. A bad summary from a weak source now falls below it.
    const worst = scoreQuality({
      sourceId: 'cryptopanic.com/rising', // weight 0.3
      headline: 'Short',
      summary: 'tiny',
      author: null,
      engagement: null,
      signals: {
        attempts: 3,
        wordCount: 20,
        truncated: true,
        entitiesPreserved: false,
        missingEntities: ['a', 'b', 'c', 'd'],
        entityPreservationRate: 0,
        totalEntities: 4,
      },
    });

    expect(worst).toBeLessThan(0.25);
    expect(shouldAutoSuppress(worst)).toBe(true);
  });
});
