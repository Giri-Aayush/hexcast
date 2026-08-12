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
  /\$[\d,.]+[TBMK]?/gi,
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
