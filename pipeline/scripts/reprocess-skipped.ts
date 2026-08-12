/**
 * Re-queue items that were skipped for a specific reason, so a corrected gate can
 * re-evaluate exactly what the old one rejected.
 *
 * Replaces reset-dryrun-victims.ts, which reset EVERY processed item with no card. That
 * was safe when a missing card could only mean a dry run, because nothing else skipped
 * items. Once gates existed it also meant too old, too thin, duplicate and
 * auto-suppressed — roughly 1,600 rows in production — so running it would re-drain and
 * re-summarize work we had deliberately rejected. A script whose name no longer matches
 * what it does is worse than no script.
 *
 * This is deliberately narrow: name the reason, see the count, then pass --write.
 *
 *   npx tsx --env-file-if-exists=../.env scripts/reprocess-skipped.ts tooThin
 *   npx tsx --env-file-if-exists=../.env scripts/reprocess-skipped.ts tooThin --write
 */
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import type { SkipReason } from '../src/db/raw-items.js';

const VALID: SkipReason[] = ['empty', 'tooOld', 'tooThin', 'duplicate', 'lowQuality'];

const reason = process.argv[2] as SkipReason | undefined;
const write = process.argv.includes('--write');

if (!reason || !VALID.includes(reason)) {
  console.error(`Usage: reprocess-skipped.ts <${VALID.join('|')}> [--write]`);
  process.exit(1);
}

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

// Only rows that produced no card. A reason plus an existing card would mean the row was
// reused for a later successful pass, and re-queueing it would duplicate work.
const { data: candidates, error } = await db
  .from('raw_items')
  .select('id, canonical_url, raw_title, published_at')
  .eq('processed', true)
  .eq('skip_reason', reason);
if (error) throw new Error(error.message);

const { data: cards } = await db
  .from('cards')
  .select('canonical_url')
  .in('canonical_url', (candidates ?? []).map((c) => c.canonical_url).slice(0, 500));
const hasCard = new Set((cards ?? []).map((c) => c.canonical_url));

const targets = (candidates ?? []).filter((c) => !hasCard.has(c.canonical_url));

console.log(`\nskipped as "${reason}": ${candidates?.length ?? 0}`);
console.log(`of those, no card yet : ${targets.length}`);
for (const t of targets.slice(0, 8)) {
  console.log(`  ${String(t.published_at).slice(0, 10)}  ${(t.raw_title ?? '').slice(0, 58)}`);
}
if (targets.length > 8) console.log(`  ... and ${targets.length - 8} more`);

if (!write) {
  console.log('\npreview only — pass --write to re-queue these for the next run\n');
  process.exit(0);
}

// Clear the reason as well as the flag: leaving a stale reason on a re-queued row would
// make the next audit read it as still-skipped.
for (const t of targets) {
  const { error: e } = await db
    .from('raw_items')
    .update({ processed: false, skip_reason: null })
    .eq('id', t.id);
  if (e) throw new Error(`${t.id}: ${e.message}`);
}
console.log(`\nre-queued ${targets.length} items — they will be re-evaluated on the next run\n`);
