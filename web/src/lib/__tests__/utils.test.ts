import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { relativeTime, extractDomain, splitFigures } from '../utils';

describe('relativeTime', () => {
  const NOW = new Date('2025-01-15T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 1 minute ago', () => {
    const iso = new Date(NOW - 30_000).toISOString(); // 30 seconds ago
    expect(relativeTime(iso)).toBe('just now');
  });

  it('returns "5m ago" for 5 minutes ago', () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe('5m ago');
  });

  it('returns "3h ago" for 3 hours ago', () => {
    const iso = new Date(NOW - 3 * 60 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe('3h ago');
  });

  it('returns "2d ago" for 2 days ago', () => {
    const iso = new Date(NOW - 2 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(iso)).toBe('2d ago');
  });

  it('returns a formatted date for 10 days ago', () => {
    const iso = new Date(NOW - 10 * 24 * 60 * 60_000).toISOString();
    const result = relativeTime(iso);
    // Jan 5 (10 days before Jan 15)
    expect(result).toBe('Jan 5');
  });

  it('returns "Invalid Date" for an invalid date string', () => {
    const result = relativeTime('invalid-date');
    // new Date('invalid-date').getTime() is NaN → diffMs is NaN → all comparisons fail → falls through to toLocaleDateString
    expect(result).toBe('Invalid Date');
  });

  it('returns "just now" for a future date', () => {
    const futureIso = new Date(NOW + 5 * 60_000).toISOString(); // 5 minutes in the future
    const result = relativeTime(futureIso);
    // diffMs is negative → diffMins is negative (e.g. -5) → diffMins < 1 is true → returns 'just now'
    expect(result).toBe('just now');
  });

  it('returns "1m ago" at exactly 1 minute boundary', () => {
    const iso = new Date(NOW - 60_000).toISOString(); // exactly 60 seconds ago
    expect(relativeTime(iso)).toBe('1m ago');
  });

  it('returns "1h ago" at exactly 60 minutes boundary', () => {
    const iso = new Date(NOW - 60 * 60_000).toISOString(); // exactly 60 minutes ago
    expect(relativeTime(iso)).toBe('1h ago');
  });

  it('returns "1d ago" at exactly 24 hours boundary', () => {
    const iso = new Date(NOW - 24 * 60 * 60_000).toISOString(); // exactly 24 hours ago
    expect(relativeTime(iso)).toBe('1d ago');
  });

  it('returns formatted date at exactly 7 days boundary', () => {
    const iso = new Date(NOW - 7 * 24 * 60 * 60_000).toISOString(); // exactly 7 days ago
    const result = relativeTime(iso);
    // 7 days before Jan 15 = Jan 8
    expect(result).toBe('Jan 8');
  });
});

describe('extractDomain', () => {
  it('extracts hostname from a full URL', () => {
    expect(extractDomain('https://blog.ethereum.org/post')).toBe('blog.ethereum.org');
  });

  it('strips www prefix', () => {
    expect(extractDomain('https://www.example.com')).toBe('example.com');
  });

  it('returns original string for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBe('not-a-url');
  });

  it('extracts hostname from URL with port', () => {
    expect(extractDomain('https://localhost:3000/path')).toBe('localhost');
  });

  it('extracts hostname from URL with query string', () => {
    expect(extractDomain('https://example.com/page?foo=bar&baz=1')).toBe('example.com');
  });

  it('returns empty string for empty string input', () => {
    // Empty string is not a valid URL → catches → returns original
    expect(extractDomain('')).toBe('');
  });

  it('returns original for protocol-relative URL', () => {
    // "//example.com/path" is not a valid URL for the URL constructor → catches → returns original
    expect(extractDomain('//example.com/path')).toBe('//example.com/path');
  });
});

describe('splitFigures', () => {
  const figures = (s: string) => splitFigures(s).filter((x) => x.figure).map((x) => x.text);
  const rebuild = (s: string) => splitFigures(s).map((x) => x.text).join('');

  it('marks spec identifiers', () => {
    expect(figures('EIP-7702 and ERC-4337 both landed')).toEqual(['EIP-7702', 'ERC-4337']);
  });

  it('marks versions, dotted and prefixed', () => {
    expect(figures('Geth v1.16.4 and Nethermind 1.34.1 ship it')).toEqual(['v1.16.4', '1.34.1']);
  });

  it('marks quantities', () => {
    expect(figures('1,214,300 EOAs, 71% of them, securing $15B')).toEqual([
      '1,214,300',
      '71%',
      '$15B',
    ]);
  });

  it('marks a blob target written as a ratio', () => {
    expect(figures('revised for the 12/18 blob target')).toEqual(['12/18']);
  });

  it('leaves small integers as prose', () => {
    // "four to six subnets" and "2 client patches" are words, not tokens. Setting
    // every digit in mono would speckle the paragraph.
    expect(figures('custody rises from 4 to 6 subnets across 2 clients')).toEqual([]);
  });

  it('never loses or reorders text', () => {
    const s = 'Since Pectra, 1,214,300 EOAs set EIP-7702 delegations — 71% to four contracts.';
    expect(rebuild(s)).toBe(s);
  });

  it('returns a single plain segment when there is nothing to mark', () => {
    expect(splitFigures('Delegate turnout fell on the treasury vote')).toEqual([
      { text: 'Delegate turnout fell on the treasury vote', figure: false },
    ]);
  });

  it('handles an empty summary', () => {
    expect(splitFigures('')).toEqual([]);
  });

  it('is not stateful across calls', () => {
    // FIGURE_RE is module-level and /g, so a leaked lastIndex would make the second
    // call skip the match.
    const s = 'EIP-7702 shipped';
    expect(figures(s)).toEqual(['EIP-7702']);
    expect(figures(s)).toEqual(['EIP-7702']);
  });
});
