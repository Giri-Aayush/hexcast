/**
 * Generate cover art for high-priority cards that do not have it.
 *
 * Covers both jobs, because they are the same job with a different WHERE clause:
 *   - backfill: cards that never had an image attempted
 *   - retry:    cards whose attempt failed transiently
 *
 *   npx tsx --env-file-if-exists=../.env scripts/backfill-card-images.ts            # preview
 *   npx tsx --env-file-if-exists=../.env scripts/backfill-card-images.ts --write
 *   npx tsx --env-file-if-exists=../.env scripts/backfill-card-images.ts --retry --write
 *   npx tsx --env-file-if-exists=../.env scripts/backfill-card-images.ts --write --limit=10
 *
 * Preview by default and it prints the bill before spending anything, because this is the
 * only script in the repo where a careless run costs real money — every card in the table
 * would be about $5.60 rather than the $1 this is scoped to.
 *
 * Never retries a 'refused': that is a statement about the prompt, so running it again
 * unchanged pays for the same answer. Fix the prompt, then use --retry --include-refused.
 */
import { createClient } from '@supabase/supabase-js';
import type { Category } from '@hexcast/shared';
import { loadConfig } from '../src/config.js';
import { HIGH_PRIORITY_CATEGORIES } from '../src/processors/priority.js';
import { generateImageFor } from '../src/processors/card-image-step.js';

/** Measured on the response's own usage.cost field, three calls, all exactly this. */
const COST_PER_IMAGE = 0.015;

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

const args = process.argv.slice(2);
const write = args.includes('--write');
const retry = args.includes('--retry');
const includeRefused = args.includes('--include-refused');
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 500);

let query = db
  .from('cards')
  .select('id, headline, category, summary, image_error, image_attempted_at')
  .in('category', HIGH_PRIORITY_CATEGORIES)
  .is('image_url', null)
  .order('published_at', { ascending: false })
  .limit(limit);

query = retry
  ? query.not('image_error', 'is', null)
  : query.is('image_attempted_at', null);

const { data: cards, error } = await query;
if (error) throw new Error(`query failed: ${error.message}`);

const eligible = (cards ?? []).filter(
  (c) => includeRefused || c.image_error !== 'refused' || !retry,
);
const refusedSkipped = (cards ?? []).length - eligible.length;

console.log(`\n${retry ? 'RETRY' : 'BACKFILL'}: ${eligible.length} cards`);
if (refusedSkipped > 0) {
  console.log(`  ${refusedSkipped} skipped as 'refused' — rerun with --include-refused after changing the prompt`);
}
console.log(`  estimated cost: $${(eligible.length * COST_PER_IMAGE).toFixed(2)} at $${COST_PER_IMAGE}/image\n`);

for (const card of eligible.slice(0, 10)) {
  const reason = card.image_error ? ` [${card.image_error}]` : '';
  console.log(`  ${card.category.padEnd(9)} ${card.headline.slice(0, 68)}${reason}`);
}
if (eligible.length > 10) console.log(`  … and ${eligible.length - 10} more`);

if (!write) {
  console.log('\nPreview only. Re-run with --write to generate and pay.\n');
  process.exit(0);
}

if (eligible.length === 0) {
  console.log('\nNothing to do.\n');
  process.exit(0);
}

console.log(`\nGenerating ${eligible.length} images…\n`);

let done = 0;
let failed = 0;

// Serial on purpose. Concurrency here buys a few minutes on a job that runs rarely, and
// costs the ability to stop it cheaply — a parallel run that goes wrong has already spent
// the money by the time anyone notices.
for (const card of eligible) {
  const before = Date.now();
  await generateImageFor(card.id, card.category as Category, card.summary);

  const { data: updated } = await db.from('cards').select('image_url').eq('id', card.id).single();
  const ok = Boolean(updated?.image_url);
  ok ? done++ : failed++;

  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${((Date.now() - before) / 1000).toFixed(1)}s  ` +
      `(${done + failed}/${eligible.length})  ${card.headline.slice(0, 56)}`,
  );
}

console.log(`\n${done} generated, ${failed} failed. Spent roughly $${(done * COST_PER_IMAGE).toFixed(2)}.\n`);
