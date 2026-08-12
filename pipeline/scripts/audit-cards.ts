/**
 * Audit existing cards against the source text they were written from.
 *
 * The benchmark measures cards as they are generated. This measures cards already in the
 * database, which is the only way to check the two things the public API cannot answer:
 * how many of the source's identifiers survived, and whether the card asserts any the
 * source never stated.
 *
 * Joins on canonical_url because that is unique on both tables, so every audited card is
 * compared against the exact text the summarizer saw — not a re-fetch of a page that may
 * have changed since.
 */
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { checkEntityPreservation, checkInvention } from '../src/processors/entity-checker.js';

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

const limit = parseInt(process.argv[2] ?? '60', 10);

const { data: cards, error } = await db
  .from('cards')
  .select('canonical_url, headline, summary, quality_score')
  .order('fetched_at', { ascending: false })
  .limit(limit);
if (error) throw new Error(error.message);

const urls = (cards ?? []).map((c) => c.canonical_url);
const { data: raws } = await db.from('raw_items').select('canonical_url, raw_title, raw_text').in('canonical_url', urls);
const sourceByUrl = new Map((raws ?? []).map((r) => [r.canonical_url, `${r.raw_title ?? ''} ${r.raw_text ?? ''}`]));

let audited = 0;
let cardsWithInvention = 0;
let totalInvented = 0;
let rateSum = 0;
let withIdentifiers = 0;
const examples: string[] = [];

for (const card of cards ?? []) {
  const source = sourceByUrl.get(card.canonical_url);
  if (!source) continue; // raw item pruned or never stored
  audited++;

  const preservation = checkEntityPreservation(source, card.summary);
  if (preservation.totalEntities > 0) {
    withIdentifiers++;
    rateSum += preservation.preservationRate;
  }

  const invention = checkInvention(source, card.summary);
  if (!invention.clean) {
    cardsWithInvention++;
    totalInvented += invention.inventedEntities.length;
    if (examples.length < 4) {
      examples.push(`  "${card.headline.slice(0, 46)}" invented: ${invention.inventedEntities.join(', ')}`);
    }
  }
}

const pct = (n: number, of: number) => (of === 0 ? 'n/a' : `${Math.round((n / of) * 100)}%`);

console.log(`\naudited                    ${audited} cards with their stored source`);
console.log(`had identifiers to keep    ${withIdentifiers}`);
console.log(`mean preservation rate     ${withIdentifiers ? (rateSum / withIdentifiers).toFixed(3) : 'n/a'}`);
console.log(`cards asserting invented   ${cardsWithInvention}  (${pct(cardsWithInvention, audited)})`);
console.log(`invented identifiers total ${totalInvented}`);
if (examples.length) {
  console.log('\nexamples:');
  console.log(examples.join('\n'));
}
console.log('\nOnly checkable identifier classes count here — EIP/ERC numbers, percentages,\ndollar amounts, version strings. Invented PROSE is not detectable this way.\n');
