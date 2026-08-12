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
import OpenAI from 'openai';
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
  // Deterministic order matters: without it Postgres can hand back different rows
  // each run, and two prompt variants would be scored on different items — which
  // makes the comparison meaningless in a way that is invisible in the output.
  .order('id', { ascending: true })
  .limit(sampleSize * 2); // over-fetch: normalize() rejects some as empty

if (error) throw new Error(error.message);

// Apply the SAME thin-source gate the pipeline applies. Without this the benchmark
// scores items production would never summarize, which flatters or maligns a model on
// inputs it will never see — and on a 113-char source any model has to invent.
const items = (data ?? [])
  .map(normalize)
  .filter((n): n is NonNullable<typeof n> => n !== null)
  .filter((n) => n.title.length + n.fullText.length >= config.minSourceChars)
  .slice(0, sampleSize);

console.log(`\nprovider : ${config.llmBaseUrl}`);
console.log(`model    : ${config.llmModel}`);
console.log(`prompt   : ${config.llmPrompt}`);
console.log(`spacing  : ${config.llmMinIntervalMs}ms`);
console.log(`extra    : ${JSON.stringify(config.llmExtraBody)}`);
console.log(`sample   : ${items.length} real raw_items, gate >= ${config.minSourceChars} chars\n`);

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

const sorted = [...rows].map((r) => r.words).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];

console.log('─'.repeat(58));
// The target is a CEILING, not a quota: a summary shorter than 60 words is the
// correct answer for a thin source. Reporting "% hitting 55-60" would score honesty
// as failure, which is what sent us chasing an impossible number in the first place.
console.log(`within 60-word limit ${pct(rows.filter((r) => r.words <= 60).length)}`);
console.log(`over the limit       ${pct(rows.filter((r) => r.words > 60).length)}`);
console.log(`over 67 truncated    ${pct(rows.filter((r) => r.words > 67).length)}`);
console.log(`median words         ${median}`);
console.log(`word spread          ${sorted[0]}-${sorted[sorted.length - 1]}`);
console.log(`entities preserved   ${pct(rows.filter((r) => r.preserved).length)}`);
console.log(`first-try            ${pct(rows.filter((r) => r.attempts === 1).length)}`);
console.log(`truncated            ${pct(rows.filter((r) => r.truncated).length)}`);
console.log(`avg attempts         ${avg((r) => r.attempts)}`);
console.log(`avg identifiers lost ${avg((r) => r.missing)}`);
console.log(`avg seconds/card     ${avg((r) => r.ms / 1000)}`);
console.log(`failed               ${failures}`);
console.log('─'.repeat(58));
// summarize() does not surface usage, so bill one representative call directly. For a
// reasoning-capable model this is the number that decides the monthly cost: reasoning
// tokens bill as OUTPUT, so if reasoning:{exclude:true} is not respected the output
// count balloons and the cost goes with it.
// Deliberately hits the PRIMARY directly, not the failover chain: the question is what
// the primary costs. Wrapped because an exhausted primary should not error the whole
// benchmark after the summaries have already been measured.
const probe = items[0];
if (probe) try {
  const llm = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl });
  const res = await llm.chat.completions.create({
    ...config.llmExtraBody,
    model: config.llmModel,
    max_tokens: 300,
    messages: [{ role: 'user', content: `Summarize in under 60 words:\n\n${probe.fullText.slice(0, config.llmMaxInputChars)}` }],
  });
  const u = res.usage as (typeof res.usage & {
    completion_tokens_details?: { reasoning_tokens?: number };
  }) | undefined;
  const reasoning = u?.completion_tokens_details?.reasoning_tokens;
  console.log('─'.repeat(58));
  console.log(`prompt tokens        ${u?.prompt_tokens ?? '?'}`);
  console.log(`completion tokens    ${u?.completion_tokens ?? '?'}`);
  console.log(
    `reasoning tokens     ${reasoning ?? 'not reported'}${
      reasoning ? '   <-- BILLED AS OUTPUT, expected ~0' : ''
    }`,
  );
} catch (e) {
  console.log('─'.repeat(58));
  console.log(`token probe skipped: ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
}

console.log('\nRead the summaries above too — these numbers say nothing about whether\nthe prose is any good, and that is what the 60-word format is for.\n');
