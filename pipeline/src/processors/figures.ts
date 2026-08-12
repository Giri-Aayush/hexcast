/**
 * Finding the numbers in a summary.
 *
 * Used for two things that must agree: deciding whether a card is worth spending a stat
 * extraction call on, and measuring across the corpus how often that is true
 * (scripts/probe-figure-density.ts). If the gate and the measurement used different
 * definitions, the measured "60% of cards are eligible" would describe a population the
 * pipeline never actually selects.
 *
 * Deliberately wider than entity-checker's ENTITY_PATTERNS, which knows only
 * EIP-N / ERC-N / N% / $N / vN.N. A stat row reads "1.21M ACCOUNTS" and "2 CLIENT
 * PATCHES" — a bare integer and an unprefixed magnitude are both figures a reader wants,
 * and neither is an identifier.
 */

export interface Figure {
  value: string;
  kind: FigureKind;
}

export type FigureKind = 'eip/erc' | 'percent' | 'money' | 'version' | 'scaled' | 'bare';

/**
 * Dates are numbers no reader wants in a stat row. "Pectra goes live on May 07, 2025 at
 * 10:05 UTC" yields 07, 2025, 10 and 05 — four numbers, zero stats — and on some cards
 * those alone were enough to clear the two-figure bar, which moved the measured
 * eligibility rate by five points. Blanked before anything else runs.
 */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:UTC|GMT|am|pm)?\b/gi,
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:,?\s+\d{4})?\b/gi,
  /\b(?:19|20)\d{2}\b/g,
  /\bQ[1-4]\s+(?:19|20)\d{2}\b/gi,
];

function stripDates(text: string): string {
  let out = text;
  for (const pattern of DATE_PATTERNS) out = out.replace(pattern, (m) => ' '.repeat(m.length));
  return out;
}

/**
 * Most-specific first. Each match is blanked out of the working copy before the next
 * pattern runs, so "$1.2M" counts once as money rather than three times as money, scaled
 * and bare. The ordering is the whole correctness argument.
 */
const FIGURE_PATTERNS: Array<[FigureKind, RegExp]> = [
  ['eip/erc', /\b(?:EIP|ERC)-\d+\b/gi],
  ['percent', /\d+(?:\.\d+)?%/g],
  ['money', /\$\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:[TBMK]\b|trillion|billion|million|thousand)?/gi],
  ['version', /\bv\d+\.\d+(?:\.\d+)?\b/gi],
  ['scaled', /\b\d+(?:\.\d+)?\s?(?:[TBMK]\b|trillion|billion|million|thousand)\b/g],
  ['bare', /\b\d+(?:[.,]\d+)*\b/g],
];

export function extractFigures(text: string): Figure[] {
  let rest = stripDates(text);
  const found: Figure[] = [];
  for (const [kind, pattern] of FIGURE_PATTERNS) {
    for (const match of rest.match(pattern) ?? []) {
      found.push({ value: match.trim(), kind });
      rest = rest.replace(match, ' '.repeat(match.length));
    }
  }
  return found;
}

/**
 * Enough figures to be worth an extraction call?
 *
 * A one-stat row is not a row, so two is the floor. Measured across 300 cards, this is
 * true of about 60% of them — meaning the check skips roughly four calls in ten, which is
 * the entire cost argument for making it before calling rather than after.
 */
export function hasEnoughFigures(summary: string, minimum = 2): boolean {
  return extractFigures(summary).length >= minimum;
}
