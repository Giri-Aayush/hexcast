export interface EntityCheckResult {
  passed: boolean;
  missingEntities: string[];
  /** How many identifiers the source contained. 0 means there was nothing to preserve. */
  totalEntities: number;
  /** Fraction kept, 0-1. The scorer wants this, not a raw count of losses. */
  preservationRate: number;
}

const ENTITY_PATTERNS: RegExp[] = [
  /EIP-\d+/g,
  /ERC-\d+/g,
  /\d+(\.\d+)?%/g,
  // Must not swallow trailing punctuation. The old /\$[\d,.]+/ captured "$3,000," and
  // "$0.9991." including the comma and full stop, so an exact-match check against a
  // source that writes "$3,000" reported the card's own figure as INVENTED. That was 7
  // of 34 invention flags on a 60-card audit — about a fifth of them false, which is
  // enough to make the measure untrustworthy in exactly the place it matters.
  /\$\d(?:[\d,]*\d)?(?:\.\d+)?[TBMK]?/gi,
  /v\d+\.\d+(\.\d+)?/g,
];

export function extractEntities(text: string): string[] {
  const entities: string[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) entities.push(...matches);
  }
  return [...new Set(entities)];
}

export function checkEntityPreservation(
  sourceText: string,
  summary: string
): EntityCheckResult {
  const sourceEntities = extractEntities(sourceText);
  // No identifiers to preserve is not a failure, and it is not evidence of quality
  // either — rate 1 says "nothing was lost", which is true.
  if (sourceEntities.length === 0) {
    return { passed: true, missingEntities: [], totalEntities: 0, preservationRate: 1 };
  }

  const missingEntities = sourceEntities.filter(
    entity => !summary.includes(entity)
  );

  // Pass if at least 80% of entities preserved,
  // AND all critical EIP/ERC numbers are present
  const preservationRate = 1 - missingEntities.length / sourceEntities.length;
  const criticalMissing = missingEntities.filter(e => /^E[IR][PC]-\d+$/i.test(e));

  return {
    passed: preservationRate >= 0.8 && criticalMissing.length === 0,
    missingEntities,
    totalEntities: sourceEntities.length,
    // Returned rather than recomputed by callers: losing 3 of 40 identifiers is a good
    // summary of a dense document, losing 3 of 4 is a bad summary of a simple one, and
    // a raw count cannot tell those apart.
    preservationRate,
  };
}

export interface InventionCheckResult {
  clean: boolean;
  /** Identifiers asserted by the summary that do not appear in the source at all. */
  inventedEntities: string[];
}

/**
 * The preservation check run backwards: which identifiers does the summary assert that
 * the source never states?
 *
 * Preservation catches OMISSION — facts the summary dropped. This catches INVENTION —
 * facts the summary made up, which is the more damaging direction for a digest that
 * promises factual accuracy. A reader cannot tell an invented EIP number from a real one.
 *
 * The case that motivated it: a card claimed "EIP-4844 proto-danksharding, lowering blob
 * transaction fees, timeline confirmed for March activation" from a source whose entire
 * body was "In this post we detail the engineering effort preparing for the Dencun hard
 * fork". Every identifier in that card was invented.
 *
 * Deliberately narrow. It only judges the identifier classes the extractor recognises —
 * EIP/ERC numbers, percentages, dollar amounts, version strings — because those are
 * checkable by exact string match against the source. Invented PROSE is not detectable
 * this way and this makes no claim to catch it.
 */
export function checkInvention(sourceText: string, summary: string): InventionCheckResult {
  const inventedEntities = extractEntities(summary).filter((entity) => !sourceText.includes(entity));
  return { clean: inventedEntities.length === 0, inventedEntities };
}
