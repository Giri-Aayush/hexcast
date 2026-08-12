/**
 * Measure a summarization provider against PROMPT.md's rubric, using real items.
 *
 * The V1 / V1.3 prompt scores in PROMPT.md are model-specific — V1 won on the local
 * 8B, V1.3 on gpt-4.1-mini. A new model has been measured against neither, so this
 * exists to answer "is it actually good" with numbers rather than a vibe before
 * production points at it.
 *
 * Reads whatever provider is configured, so it benchmarks OpenAI, Groq, NVIDIA NIM
 * or a local Ollama with no code change:
 *
 *   LLM_BASE_URL=https://api.groq.com/openai/v1 LLM_API_KEY=gsk_... \
 *   LLM_MODEL=llama-3.3-70b-versatile LLM_PROMPT=v1 \
 *   npx tsx --env-file-if-exists=../.env scripts/benchmark-summarizer.ts 10
 *
 * Writes nothing. It reads raw_items and prints; no cards are created, so it is
 * safe to run against any database.
 */
import { createClient } from '@supabase/supabase-js';
import { summarize } from '../src/processors/summarizer.js';
import { normalize } from '../src/processors/normalizer.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

const sampleSize = parseInt(process.argv[2] ?? '10', 10);

const { data, error } = await supabase
  .from('raw_items')
  .select('*')
  .eq('processed', false)
  .limit(sampleSize * 2); // over-fetch: normalize() rejects some as empty

if (error) throw new Error(error.message);

const items = (data ?? []).map(normalize).filter((n): n is NonNullable<typeof n> => n !== null).slice(0, sampleSize);

console.log(`\nprovider : ${config.llmBaseUrl}`);
console.log(`model    : ${config.llmModel}`);
console.log(`prompt   : ${config.llmPrompt}`);
console.log(`spacing  : ${config.llmMinIntervalMs}ms`);
console.log(`sample   : ${items.length} real raw_items\n`);

interface Row {
  words: number;
  attempts: number;
  preserved: boolean;
  missing: number;
  truncated: boolean;
  ms: number;
}

const rows: Row[] = [];
let failures = 0;

for (const [i, item] of items.entries()) {
  const started = Date.now();
  try {
    const { headline, summary, signals } = await summarize(item.fullText, item.title);
    const ms = Date.now() - started;
    rows.push({
      words: signals.wordCount,
      attempts: signals.attempts,
      preserved: signals.entitiesPreserved,
      missing: signals.missingEntities.length,
      truncated: signals.truncated,
      ms,
    });

    console.log(`[${i + 1}] ${signals.wordCount}w, ${signals.attempts} attempt(s), ${(ms / 1000).toFixed(1)}s${
      signals.entitiesPreserved ? '' : `, dropped ${signals.missingEntities.length}: ${signals.missingEntities.join(', ')}`
    }${signals.truncated ? ', TRUNCATED' : ''}`);
    console.log(`    ${headline}`);
    console.log(`    ${summary}\n`);
  } catch (e) {
    failures++;
    console.log(`[${i + 1}] FAILED: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

if (rows.length === 0) {
  console.log('no successful summaries — nothing to score');
  process.exit(1);
}

const pct = (n: number) => `${Math.round((n / rows.length) * 100)}%`;
const avg = (get: (r: Row) => number) => (rows.reduce((sum, r) => sum + get(r), 0) / rows.length).toFixed(2);

console.log('─'.repeat(58));
console.log(`in 55-60 target      ${pct(rows.filter((r) => r.words >= 55 && r.words <= 60).length)}`);
console.log(`in 50-65 fallback    ${pct(rows.filter((r) => r.words >= 50 && r.words <= 65).length)}`);
console.log(`over 67 hard ceiling ${pct(rows.filter((r) => r.words > 67).length)}`);
console.log(`entities preserved   ${pct(rows.filter((r) => r.preserved).length)}`);
console.log(`first-try            ${pct(rows.filter((r) => r.attempts === 1).length)}`);
console.log(`truncated            ${pct(rows.filter((r) => r.truncated).length)}`);
console.log(`avg attempts         ${avg((r) => r.attempts)}`);
console.log(`avg identifiers lost ${avg((r) => r.missing)}`);
console.log(`avg seconds/card     ${avg((r) => r.ms / 1000)}`);
console.log(`failed               ${failures}`);
console.log('─'.repeat(58));
console.log('\nRead the summaries above too — these numbers say nothing about whether\nthe prose is any good, and that is what the 60-word format is for.\n');
