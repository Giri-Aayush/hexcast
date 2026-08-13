import type { Category } from '@hexcast/shared';

/**
 * The categories worth interrupting someone for.
 *
 * One definition, three consumers: the high-priority queue, cover-image generation, and
 * the image backfill script. Cover art costs about 200x what a card's text costs to
 * produce, so it runs only on these — and reading the gate off the SAME predicate the
 * queue uses means "gets an image" cannot drift away from "we think this matters". Change
 * the rule here and both follow.
 */
export function isHighPriority(category: Category): boolean {
  return category === 'SECURITY' || category === 'UPGRADE';
}

export const HIGH_PRIORITY_CATEGORIES: Category[] = ['SECURITY', 'UPGRADE'];
