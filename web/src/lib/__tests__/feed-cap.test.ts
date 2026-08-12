import { describe, it, expect, afterEach, vi } from 'vitest';
import { feedCap, cappedLimit, isCapped } from '../feed-cap';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('feedCap', () => {
  it('is null when MAX_FEED_CARDS is unset — the full product', () => {
    expect(feedCap()).toBeNull();
    expect(isCapped()).toBe(false);
  });

  it('reads a positive integer', () => {
    vi.stubEnv('MAX_FEED_CARDS', '10');
    expect(feedCap()).toBe(10);
    expect(isCapped()).toBe(true);
  });

  it('floors a fractional value', () => {
    vi.stubEnv('MAX_FEED_CARDS', '10.9');
    expect(feedCap()).toBe(10);
  });

  it('treats a non-numeric value as unset rather than crashing the feed', () => {
    vi.stubEnv('MAX_FEED_CARDS', 'ten');
    expect(feedCap()).toBeNull();
  });

  it('treats 0 or negative as unset — a misconfig should not blank the feed', () => {
    vi.stubEnv('MAX_FEED_CARDS', '0');
    expect(feedCap()).toBeNull();
    vi.stubEnv('MAX_FEED_CARDS', '-5');
    expect(feedCap()).toBeNull();
  });
});

describe('cappedLimit', () => {
  it('returns the requested limit unchanged when uncapped', () => {
    expect(cappedLimit(20)).toBe(20);
  });

  it('clamps the requested limit down to the cap', () => {
    vi.stubEnv('MAX_FEED_CARDS', '10');
    expect(cappedLimit(20)).toBe(10);
  });

  it('does not raise a smaller request up to the cap', () => {
    vi.stubEnv('MAX_FEED_CARDS', '10');
    expect(cappedLimit(5)).toBe(5);
  });
});
