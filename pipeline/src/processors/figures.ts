/**
 * Finding the numbers in a summary.
 *
 * Used for two things that must agree: deciding whether a card is worth spending a stat
 * extraction call on, and measuring across the corpus how often that is true
 * (scripts/probe-figure-density.ts). If the gate and the measurement used different
 * definitions, the measured eligibility rate would describe a population the pipeline
 * never actually selects.
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
 * A one-stat row is not a row, so two is the floor.
 *
 * HOW OFTEN THIS PASSES DEPENDS ON THE MODEL AND PROMPT, and quoting a single number here
 * would be wrong. The first measurement said 60% and described llama3.1:8b, because
 * PIPELINE_ENV=dev silently defaults to Ollama and the local database had been written by
 * it — while production runs DeepSeek, which front-loads far more figures. Re-measuring on
 * the production model moved it well above 60%, and changing the prompt moved it again.
 *
 * So the useful statement is the shape, not the figure: a meaningful minority of summaries
 * carry too few figures to fill a row, the call is skipped for them, and that skip is the
 * whole cost argument for checking before calling rather than after. Run
 * scripts/probe-figures-by-model.ts against whatever provider is configured to get the
 * number for that configuration.
 */
export function hasEnoughFigures(summary: string, minimum = 2): boolean {
  return extractFigures(summary).length >= minimum;
}
