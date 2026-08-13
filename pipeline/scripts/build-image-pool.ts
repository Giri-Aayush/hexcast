/**
 * Build the reusable cover-art pool, then assign an image to every card.
 *
 *   npx tsx --env-file=<env> scripts/build-image-pool.ts            # preview + cost
 *   npx tsx --env-file=<env> scripts/build-image-pool.ts --write
 *   npx tsx --env-file=<env> scripts/build-image-pool.ts --write --assign-only
 *
 * Two phases, separable because they fail differently. Generation costs money and can be
 * interrupted; assignment is free, deterministic, and safe to re-run. `--assign-only` skips
 * straight to the second, which is what you want after adding a category or fixing a URL.
 *
 * Generation is idempotent: an image already in the bucket is skipped, so a run that dies
 * half way resumes where it stopped rather than paying twice.
 */
import { createClient } from '@supabase/supabase-js';
import type { Category } from '@hexcast/shared';
import { loadConfig } from '../src/config.js';
import { generateCardImage } from '../src/processors/image-generator.js';
import { CATEGORY_STYLES } from '../src/processors/image-prompt.js';
import { POOL_SIZE, poolPath, buildPoolPrompt, poolIndexFor } from '../src/processors/image-pool.js';
import { IMAGE_BUCKET, ensureImageBucket, uploadCardImage } from '../src/db/card-images.js';

const COST_PER_IMAGE = 0.015;

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

const args = process.argv.slice(2);
const write = args.includes('--write');
const assignOnly = args.includes('--assign-only');
const seedFromCards = args.includes('--seed-from-cards');

const CATEGORIES = Object.keys(CATEGORY_STYLES) as Category[];

await ensureImageBucket();

/** What is already in the bucket, so an interrupted run does not pay for the same image twice. */
async function existingPoolImages(): Promise<Set<string>> {
  const present = new Set<string>();
  for (const category of CATEGORIES) {
    const { data } = await db.storage.from(IMAGE_BUCKET).list(`pool/${category}`, { limit: 1000 });
    for (const file of data ?? []) present.add(`pool/${category}/${file.name}`);
  }
  return present;
}

/**
 * Promote already-generated per-card images into pool slots.
 *
 * The first ten images were generated per-card, story-specific, and reviewed as good art.
 * They are paid for and they are better composed than a generic pool image, so copying them
 * into their category's pool costs nothing and wastes nothing. Storage-side copy, so no
 * download and re-upload.
 *
 * They stop being story-specific the moment they are shared, which is the accepted trade of
 * the pool approach — they were never anything but abstract texture.
 */
async function seedPoolFromExistingCards(): Promise<number> {
  const { data: cards, error: cardError } = await db
    .from('cards')
    .select('id, category, image_url')
    .not('image_url', 'is', null)
    .order('published_at', { ascending: false });
  if (cardError) throw new Error(`seed query failed: ${cardError.message}`);

  // Only images named <card_id>.png — the per-card generation. Anything already under pool/
  // is a pool image and must not be copied over itself.
  const perCard = (cards ?? []).filter((c) => c.image_url?.includes(`${c.id}.png`));
  const nextSlot = new Map<string, number>();
  let copied = 0;

  for (const card of perCard) {
    const category = card.category as Category;
    const index = nextSlot.get(category) ?? 0;
    if (index >= POOL_SIZE) continue;

    const { error: copyError } = await db.storage
      .from(IMAGE_BUCKET)
      .copy(`${card.id}.png`, poolPath(category, index));

    if (copyError) {
      console.log(`  skip ${card.id.slice(0, 8)} -> ${poolPath(category, index)}: ${copyError.message}`);
      continue;
    }

    nextSlot.set(category, index + 1);
    copied++;
  }

  if (copied > 0) console.log(`  reused ${copied} already-generated images as pool slots`);
  return copied;
}

if (seedFromCards && write) await seedPoolFromExistingCards();

const existing = await existingPoolImages();
const wanted: Array<{ category: Category; index: number; path: string }> = [];
for (const category of CATEGORIES) {
  for (let index = 0; index < POOL_SIZE; index++) {
    const path = poolPath(category, index);
    if (!existing.has(path)) wanted.push({ category, index, path });
  }
}

console.log(`\npool: ${POOL_SIZE} images x ${CATEGORIES.length} categories = ${POOL_SIZE * CATEGORIES.length}`);
console.log(`  already in bucket: ${existing.size}`);
console.log(`  to generate:       ${wanted.length}  ->  $${(wanted.length * COST_PER_IMAGE).toFixed(2)}`);

if (!assignOnly && !write) {
  console.log('\nPreview only. Re-run with --write to generate and pay.\n');
  process.exit(0);
}

if (!assignOnly && wanted.length > 0) {
  console.log(`\nGenerating ${wanted.length} images…\n`);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required to generate the pool');

  let done = 0;
  let failed = 0;

  // Four at a time. The per-card path is deliberately serial so a runaway cannot spend much,
  // but here the total is known and bounded before the first call — 128 images at a fixed
  // price — so the only thing concurrency risks is finishing sooner.
  const CONCURRENCY = 4;
  const queue = [...wanted];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const started = Date.now();
        const result = await generateCardImage(job.category, [], {
          apiKey,
          // The pool prompt is category-only; passing it directly rather than through the
          // motif path keeps the two prompts from drifting into each other.
          promptOverride: buildPoolPrompt(job.category, job.index),
        });

        if (!result.png) {
          failed++;
          console.log(`  FAIL ${job.path}  ${result.error}: ${result.detail?.slice(0, 60)}`);
          continue;
        }

        try {
          await uploadCardImage(job.path, result.png);
          done++;
          console.log(
            `  ok   ${((Date.now() - started) / 1000).toFixed(1)}s  (${done + failed}/${wanted.length})  ${job.path}`,
          );
        } catch (error) {
          failed++;
          console.log(`  FAIL upload ${job.path}: ${String(error).slice(0, 60)}`);
        }
      }
    }),
  );

  console.log(`\n${done} generated, ${failed} failed. Spent roughly $${(done * COST_PER_IMAGE).toFixed(2)}.\n`);
}

// ── Assign ────────────────────────────────────────────────────────────────

const { data: cards, error } = await db.from('cards').select('id, category').limit(5000);
if (error) throw new Error(`card query failed: ${error.message}`);

const available = await existingPoolImages();
const publicUrl = (path: string) => db.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;

let assigned = 0;
let uncovered = 0;
const perCategory = new Map<string, number>();

for (const card of cards ?? []) {
  const category = card.category as Category;

  // Only index into images that actually exist. A category whose generation failed would
  // otherwise get URLs pointing at nothing — and a 404 renders as the dither fallback, which
  // looks exactly like a card that was never assigned. Silent either way, so check.
  const present = Array.from({ length: POOL_SIZE }, (_, i) => poolPath(category, i)).filter((p) =>
    available.has(p),
  );

  if (present.length === 0) {
    uncovered++;
    continue;
  }

  const path = present[poolIndexFor(card.id, present.length)];
  const { error: updateError } = await db
    .from('cards')
    .update({ image_url: publicUrl(path), image_error: null })
    .eq('id', card.id);

  if (updateError) throw new Error(`assign failed for ${card.id}: ${updateError.message}`);

  assigned++;
  perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
}

console.log(`assigned ${assigned} cards${uncovered > 0 ? `, ${uncovered} left uncovered (no pool image for their category)` : ''}`);
for (const [category, n] of [...perCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${category.padEnd(15)} ${n}`);
}
