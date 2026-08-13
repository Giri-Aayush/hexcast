/**
 * Does figure density depend on which model wrote the summary?
 *
 * probe-figure-density.ts measures figures in summaries ALREADY IN THE DATABASE. That
 * conflates two things, and it burned me: the local database was written by llama3.1:8b —
 * PIPELINE_ENV=dev with no LLM_* overrides defaults to Ollama — while production runs
 * DeepSeek. So "60% of cards carry two or more figures", the number the stat row's whole
 * layout argument rested on, described a model the product does not use.
 *
 * This summarizes the SAME source items with whatever provider the environment points at,
 * so two runs with different LLM_MODEL are directly comparable. Nothing is written to the
 * database.
 *
 *   npx tsx --env-file=<env> scripts/probe-figures-by-model.ts [count]
 *
 * Costs one summary call per item, roughly $0.0002 each on DeepSeek.
 */
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../src/config.js';
import { summarize } from '../src/processors/summarizer.js';
import { normalize } from '../src/processors/normalizer.js';
import { extractFigures } from '../src/processors/figures.js';
import { roundRobinBySource } from '../src/processors/pipeline.js';
import type { RawItem } from '@hexcast/shared';

const config = loadConfig();
const db = createClient(config.supabaseUrl, config.supabaseServiceKey);
const count = parseInt(process.argv[2] ?? '25', 10);

// Same gates the pipeline applies, so the sample is the population that actually becomes
// cards rather than everything in the queue. Without this the probe scores items the
// pipeline would have skipped — which is how an earlier benchmark measured a 113-char
// source and reported the result as representative.
const cutoff = new Date(Date.now() - config.maxSourceAgeDays * 86_400_000);

const { data, error } = await db
  .from('raw_items')
  .select('*')
  .gte('published_at', cutoff.toISOString())
  .order('published_at', { ascending: false })
  .limit(count * 30);

if (error) throw new Error(`query failed: ${error.message}`);

// Spread the sample across sources, using the pipeline's own round-robin so the probe
// selects the way a real batch does. Sorting by recency alone gave a sample that was 16 of
// 25 DefiLlama metrics items — the highest-frequency source — and METRICS is the category
// most dense in figures, so the result flattered itself. Skewed samples have now cost me
// two wrong numbers in one day; this makes the fix structural rather than remembered.
const spread = roundRobinBySource((data ?? []) as RawItem[]);

const eligible: RawItem[] = [];
for (const row of spread) {
  const normalized = normalize(row);
  if (!normalized) continue;
  const source = `${normalized.title} ${normalized.fullText}`;
  const dense = extractFigures(source).length >= config.minSourceIdentifiers;
  if (source.length < config.minSourceChars && !dense) continue;
  eligible.push(row);
  if (eligible.length === count) break;
}

const primary = config.llmProviders[0];
console.log(`\nmodel: ${primary.model}  prompt: ${primary.prompt}  items: ${eligible.length}\n`);

const results: Array<{ figures: number; words: number; headline: string; source: string }> = [];

for (const [index, item] of eligible.entries()) {
  const normalized = normalize(item)!;
  try {
    const { headline, summary } = await summarize(normalized.fullText, normalized.title);
    const figures = extractFigures(summary);
    results.push({
      figures: figures.length,
      words: summary.split(/\s+/).filter(Boolean).length,
      headline,
      source: item.source_id,
    });
    console.log(
      `  ${String(index + 1).padStart(3)}/${eligible.length}  figures=${figures.length}  ` +
        `words=${results.at(-1)!.words}  ${headline.slice(0, 52)}`,
    );
  } catch (e) {
    console.log(`  ${String(index + 1).padStart(3)}/${eligible.length}  FAILED  ${String(e).slice(0, 70)}`);
  }
}

if (results.length === 0) throw new Error('no summaries produced');

const twoPlus = results.filter((r) => r.figures >= 2).length;
const threePlus = results.filter((r) => r.figures >= 3).length;
const pct = (n: number) => `${((n / results.length) * 100).toFixed(0)}%`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

console.log(`\n${results.length} summaries by ${primary.model}`);
console.log(`  stat row possible (>=2 figures)   ${twoPlus}/${results.length}  ${pct(twoPlus)}`);
console.log(`  full three slots  (>=3 figures)   ${threePlus}/${results.length}  ${pct(threePlus)}`);
console.log(`  median figures per summary        ${median(results.map((r) => r.figures))}`);
console.log(`  median words per summary          ${median(results.map((r) => r.words))}`);
console.log(`  distinct sources in sample        ${new Set(results.map((r) => r.source)).size}`);

// Per-source, because the aggregate hides the spread that matters: a feed of metrics items
// and a feed of governance posts have very different figure density, and the card layout has
// to survive the sparse end.
const bySource = new Map<string, number[]>();
for (const r of results) {
  const list = bySource.get(r.source) ?? [];
  list.push(r.figures);
  bySource.set(r.source, list);
}
console.log('\nfigures per summary, by source');
for (const [source, figs] of [...bySource.entries()].sort((a, b) => median(a[1]) - median(b[1]))) {
  console.log(`  ${source.slice(0, 34).padEnd(34)} n=${String(figs.length).padStart(2)}  median ${median(figs)}  min ${Math.min(...figs)}`);
}
