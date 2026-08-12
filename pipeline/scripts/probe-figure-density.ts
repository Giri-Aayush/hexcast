/**
 * How many figures does a real summary actually carry?
 *
 * The stat row (#55) pulls up to three {value, label} pairs verbatim out of the summary.
 * That only works if the summary HAS figures — and a third LLM call per card is only
 * worth making if enough cards qualify. This measures the ceiling before we build the
 * thing: what fraction of real cards could show a stat row at all, and how many could
 * fill all three slots.
 *
 * "Figure" is deliberately wider than entity-checker's ENTITY_PATTERNS, which only knows
 * EIP-N / ERC-N / N% / $N / vN.N. The row in the mock reads "1.21M ACCOUNTS",
 * "71% TO 4 CONTRACTS", "2 CLIENT PATCHES" — a bare "2" and an unprefixed "1.21M" are
 * both figures a reader would want, and neither is an entity.
 *
 *   npx tsx scripts/probe-figure-density.ts [limit]
 *
 * Reads only. Nothing is written.
 */
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { extractFigures, type Figure } from '../src/processors/figures.js';

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);

const limit = parseInt(process.argv[2] ?? '200', 10);

const { data: cards, error } = await db
  .from('cards')
  .select('headline, summary, category, fetched_at')
  .order('fetched_at', { ascending: false })
  .limit(limit);

if (error) throw new Error(`query failed: ${error.message}`);
if (!cards?.length) throw new Error('no cards returned — is this pointed at a database with cards?');

const rows = cards.map((c) => ({ ...c, figures: extractFigures(c.summary) }));

const distribution = new Map<number, number>();
const kindTotals = new Map<string, number>();
const categories = new Map<string, { total: number; eligible: number }>();

for (const row of rows) {
  const bucket = Math.min(row.figures.length, 6);
  distribution.set(bucket, (distribution.get(bucket) ?? 0) + 1);
  for (const figure of row.figures) {
    kindTotals.set(figure.kind, (kindTotals.get(figure.kind) ?? 0) + 1);
  }
  const category = categories.get(row.category) ?? { total: 0, eligible: 0 };
  category.total += 1;
  if (row.figures.length >= 2) category.eligible += 1;
  categories.set(row.category, category);
}

const pct = (n: number) => `${((n / rows.length) * 100).toFixed(0)}%`;
const twoPlus = rows.filter((r) => r.figures.length >= 2).length;
const threePlus = rows.filter((r) => r.figures.length >= 3).length;

console.log(`\n${rows.length} cards, newest first\n`);

console.log('figures per summary');
for (const bucket of [...distribution.keys()].sort((a, b) => a - b)) {
  const count = distribution.get(bucket)!;
  const bar = '#'.repeat(Math.round((count / rows.length) * 50));
  console.log(`  ${bucket === 6 ? '6+' : ` ${bucket}`}  ${String(count).padStart(4)}  ${pct(count).padStart(4)}  ${bar}`);
}

// A lower bound worth reporting next to the headline number. Single-digit bare integers
// are the ambiguous case: "2 client patches" is a real stat, "the 3rd post-Merge upgrade"
// is an ordinal wearing the same costume, and no regex can tell them apart — that
// judgement is exactly what the LLM call is for. Counting only unambiguous figures gives
// the floor, so the true rate sits somewhere in the band rather than at the optimistic end.
const isStrong = (f: Figure) => f.kind !== 'bare' || f.value.replace(/\D/g, '').length > 1;
const strongTwoPlus = rows.filter((r) => r.figures.filter(isStrong).length >= 2).length;
const strongThreePlus = rows.filter((r) => r.figures.filter(isStrong).length >= 3).length;

console.log(`\nstat row possible at all (>=2 figures)  ${twoPlus}/${rows.length}  ${pct(twoPlus)}   floor ${pct(strongTwoPlus)}`);
console.log(`all three slots filled    (>=3 figures)  ${threePlus}/${rows.length}  ${pct(threePlus)}   floor ${pct(strongThreePlus)}`);

console.log('\nfigure kinds, total occurrences');
for (const [kind, n] of [...kindTotals.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind.padEnd(9)} ${String(n).padStart(4)}`);
}

// Bare integers are the loosest pattern and the one most likely to be wrong, so show what
// they actually are. If the common ones read as ordinals or IDs rather than quantities,
// the eligible percentage above is optimistic and needs discounting.
const bareValues = new Map<string, number>();
for (const row of rows) {
  for (const figure of row.figures) {
    if (figure.kind === 'bare') bareValues.set(figure.value, (bareValues.get(figure.value) ?? 0) + 1);
  }
}
console.log(`\nmost common bare values (${bareValues.size} distinct)`);
console.log(
  '  ' +
    [...bareValues.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([v, n]) => `${v}x${n}`)
      .join('  '),
);

console.log('\nby category');
for (const [name, v] of [...categories.entries()].sort((a, b) => b[1].total - a[1].total)) {
  const share = `${((v.eligible / v.total) * 100).toFixed(0)}%`;
  console.log(`  ${name.padEnd(14)} ${String(v.eligible).padStart(3)}/${String(v.total).padEnd(4)} ${share.padStart(4)} eligible`);
}

const show = (label: string, sample: typeof rows) => {
  if (!sample.length) return;
  console.log(`\n${label}`);
  for (const row of sample) {
    console.log(`\n  ${row.headline}`);
    console.log(`  ${row.summary}`);
    console.log(`  -> ${row.figures.map((f) => `${f.value} [${f.kind}]`).join(', ') || '(none)'}`);
  }
};

show('richest summaries', [...rows].sort((a, b) => b.figures.length - a.figures.length).slice(0, 3));
// The near-miss case decides the fallback: if one-figure cards are common and the single
// figure is a good one, a one-stat row may beat showing nothing.
show('exactly one figure — the near-miss case', rows.filter((r) => r.figures.length === 1).slice(0, 3));
show('no figures at all', rows.filter((r) => r.figures.length === 0).slice(0, 2));
