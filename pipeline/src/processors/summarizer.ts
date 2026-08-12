import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { checkEntityPreservation } from './entity-checker.js';
import { loadConfig, type LlmProvider } from '../config.js';

// ── AI Client Setup ────────────────────────────────────────────────────

interface Endpoint extends LlmProvider {
  client: OpenAI;
}

/**
 * Any OpenAI-compatible endpoint: OpenAI, Groq, NVIDIA NIM, OpenRouter, a self-hosted
 * vLLM, or a local Ollama. This used to be a hardcoded fork on PIPELINE_ENV, which made
 * moving off paid OpenAI a code change rather than a config one.
 */
function loadEndpoints(): Endpoint[] {
  return loadConfig().llmProviders.map((provider) => ({
    ...provider,
    client: new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl }),
  }));
}

/**
 * Worth trying the next provider, or worth surfacing?
 *
 * Rate limits, server faults and transport failures are the provider's problem and
 * another one may answer. A rejected key or a malformed request is OUR problem, and
 * falling through would hide it behind a working fallback — which is exactly how a dead
 * OpenAI key sat undetected while every item failed.
 */
function isWorthFailingOver(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === undefined) return true; // no HTTP status: timeout, DNS, socket
  if (status === 429) return true;
  return status >= 500;
}

/**
 * Call the first provider that answers.
 *
 * Wraps the individual API CALL rather than the item, because the retry loop below
 * retries WORD COUNT, not transport. Sharing them would make a 429 increment `attempts`,
 * and `attempts` feeds quality_score — a card would score lower because a provider was
 * busy, which is scoring the infrastructure as summary quality.
 */
async function callWithFailover(
  endpoints: Endpoint[],
  build: (endpoint: Endpoint) => Parameters<OpenAI['chat']['completions']['create']>[0],
): Promise<{ text: string; endpoint: Endpoint }> {
  let lastError: unknown;

  for (const [index, endpoint] of endpoints.entries()) {
    try {
      await rateLimit(endpoint);
      const response = await endpoint.client.chat.completions.create(build(endpoint));
      const text =
        ('choices' in response ? response.choices[0]?.message?.content : undefined)?.trim() ?? '';

      if (index > 0) logger.warn(`Used fallback provider ${endpoint.label}`);
      return { text, endpoint };
    } catch (error) {
      lastError = error;
      const remaining = endpoints.length - index - 1;

      if (!isWorthFailingOver(error) || remaining === 0) throw error;

      logger.warn(
        `${endpoint.label} failed (${(error as { status?: number })?.status ?? 'no status'}), ` +
          `trying ${endpoints[index + 1].label}`,
      );
    }
  }

  throw lastError;
}

// ── Prompts (from PROMPT.md benchmarks) ─────────────────────────────────

// V1 — Best for Ollama (score 81.9, 100% word count compliance)
const SYSTEM_PROMPT_V1 = `You write 60-word news cards for Hexcast, an Ethereum ecosystem digest read by
protocol developers and DeFi professionals. Write like Inshorts: factual, punchy,
zero filler. Every word earns its place.`;

function buildUserPromptV1(content: string): string {
  return `Summarize this content in no more than 60 words.

Use fewer words if the content does not support 60. A short source deserves a short
summary — never pad, never repeat, and never add a fact the content does not state to
reach a length.

Style rules:
- Open with the single most important fact or action — never start with "The".
- Use short, declarative sentences. Active voice only.
- Front-load numbers: dollar amounts, percentages, version numbers, EIP/ERC identifiers.
- Preserve exact technical identifiers as they appear (EIP-7702 not "EIP 7702").
- Include who did it, what happened, and why it matters — in that order.
- No editorializing, no adjectives like "significant" or "important".
- No markdown, no bullet points, no preamble.

${content}`;
}

// V1.3 — Best for GPT-4.1 Mini (score 68.3, 88.6% entity preservation)
const SYSTEM_PROMPT_V13 = `You write 60-word news cards for Hexcast, an Ethereum ecosystem digest read by
protocol developers and DeFi professionals. Write like Inshorts: factual, punchy,
zero filler. Every word earns its place.

When given an article, first identify key technical identifiers in a <think> block,
then write the summary. Only the text after </think> is shown to readers.`;

function buildUserPromptV13(content: string): string {
  return `Summarize this content in no more than 60 words — fewer if the content does
not support 60. Never pad or invent detail to reach a length.

Step 1: In a <think> block, list all technical identifiers you MUST preserve:
  - EIP/ERC numbers (e.g., EIP-7702)
  - Version numbers (e.g., v5.4.0)
  - Dollar amounts (e.g., $8.7M)
  - Percentages (e.g., 92.4%)
  - Named authors or entities

Step 2: After </think>, write up to 60 words incorporating as many identifiers as possible.

Rules:
- Open with the most important fact — never start with "The".
- Short, declarative sentences. Active voice.
- Front-load numbers and identifiers.
- No editorializing, no filler. No markdown.

${content}`;
}

// ── Post-processing ──────────────────────────────────────────────────────

/**
 * Small models narrate before they answer — "Here is a 60-word news card
 * summarizing the article:" — despite the prompt asking for no preamble. That
 * line is not summary text, and leaving it in both showed up verbatim on the
 * card and ate into the 60-word budget.
 */
function stripPreamble(text: string): string {
  return text
    .replace(/^(?:sure[,!]?\s*)?(?:here(?:'s| is)|below is)\b[^\n:]{0,80}:\s*/i, '')
    .replace(/^summary:\s*/i, '')
    .trim();
}

/** Strip <think>...</think> block and any conversational preamble. */
function extractSummaryText(raw: string): string {
  const thinkEnd = raw.indexOf('</think>');
  const body =
    thinkEnd !== -1
      ? raw.slice(thinkEnd + '</think>'.length)
      : raw.replace(/<[^>]+>/g, '');
  return stripPreamble(body.trim());
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ── Main Summarizer ──────────────────────────────────────────────────────

const MAX_RETRIES = 3;
/** Stated ceiling. Anything at or under this is accepted as-is. */
const MAX_WORDS = 60;
/** Below this the model has not summarized anything; worth one more attempt. */
const MIN_USEFUL_WORDS = 20;
const HARD_MAX_WORDS = 67; // absolute ceiling — truncate anything above this

// Concurrent-safe rate limiter, PER PROVIDER. Serializes calls through a promise chain
// so concurrent workers stay spaced apart. State is keyed by base URL because a shared
// limiter would pace a fallback on the primary's schedule — either needlessly slow or
// straight over the fallback's own cap, and invisible until it misbehaves in production.
const limiters = new Map<string, { chain: Promise<void>; lastCallAt: number }>();

async function rateLimit(endpoint: { baseUrl: string; minIntervalMs: number }) {
  if (endpoint.minIntervalMs <= 0) return;

  const limiter = limiters.get(endpoint.baseUrl) ?? { chain: Promise.resolve(), lastCallAt: 0 };
  limiters.set(endpoint.baseUrl, limiter);

  const prev = limiter.chain;
  let release: () => void;
  limiter.chain = new Promise<void>((r) => { release = r; });
  await prev;

  const elapsed = Date.now() - limiter.lastCallAt;
  if (elapsed < endpoint.minIntervalMs) {
    await new Promise((r) => setTimeout(r, endpoint.minIntervalMs - elapsed));
  }
  limiter.lastCallAt = Date.now();
  release!();
}

/**
 * How the summary was actually produced. All of this was already computed and
 * logged, then discarded — which is why quality_score had nothing real to score
 * and ended up measuring whether a headline was longer than 10 characters.
 */
export interface SummarySignals {
  /** 1 means it landed in range first try. */
  attempts: number;
  wordCount: number;
  /** Ran past the 67-word ceiling and got cut mid-thought. */
  truncated: boolean;
  entitiesPreserved: boolean;
  missingEntities: string[];
}

export async function summarize(
  fullText: string,
  title: string
): Promise<{ headline: string; summary: string; signals: SummarySignals }> {
  const endpoints = loadEndpoints();
  const primary = endpoints[0];
  const promptVersion = primary.prompt;

  logger.debug(
    `Summarizing with ${primary.model} (${promptVersion})` +
      (endpoints.length > 1 ? `, ${endpoints.length - 1} fallback(s)` : ''),
  );

  // Truncate to keep inference fast and within token limits. Taken from the primary so
  // the text sent is identical whichever provider ends up answering — otherwise a
  // failover would silently summarize a different amount of the article.
  const maxChars = primary.maxInputChars;
  const truncatedText =
    fullText.length > maxChars
      ? fullText.slice(0, maxChars) + '\n\n[Content truncated]'
      : fullText;

  // Which PROMPT.md variant to use — configured, not inferred from the environment.
  const systemPrompt = promptVersion === 'v1.3' ? SYSTEM_PROMPT_V13 : SYSTEM_PROMPT_V1;
  const buildUserPrompt = promptVersion === 'v1.3' ? buildUserPromptV13 : buildUserPromptV1;

  let summary = '';
  let lastWordCount = 0;
  let attempts = 0;
  let truncated = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    attempts = attempt;
    let prompt = buildUserPrompt(truncatedText);

    // On retry: say which way it went wrong. Only overshoot and near-empty output are
    // worth retrying — a 43-word summary of a thin source is the correct answer, and
    // asking again for 60 just invites invention.
    if (attempt > 1) {
      prompt +=
        lastWordCount > MAX_WORDS
          ? `\n\nIMPORTANT: Your previous summary was ${lastWordCount} words, over the ${MAX_WORDS}-word limit. Cut the least important detail. Do not exceed ${MAX_WORDS}.`
          : `\n\nIMPORTANT: Your previous summary was only ${lastWordCount} words, which is too short to be useful. Include the concrete facts the content states.`;
    }

    // On retry: check entity preservation from previous attempt
    if (attempt > 1 && summary) {
      const entityCheck = checkEntityPreservation(truncatedText, summary);
      if (!entityCheck.passed && entityCheck.missingEntities.length > 0) {
        prompt += `\nYou MUST include these entities: ${entityCheck.missingEntities.join(', ')}`;
      }
    }

    const { text: rawOutput } = await callWithFailover(endpoints, (endpoint) => ({
      ...endpoint.extraBody,
      model: endpoint.model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }));

    // Sanitize in both modes: prod (V1.3) emits a <think> block, and dev models
    // narrate ("Here is a 60-word news card…"). Must happen before the word
    // count, or the enforcement below measures text that never reaches the card.
    summary = extractSummaryText(rawOutput);
    lastWordCount = countWords(summary);

    // Accept anything within the ceiling that actually says something. Length below
    // the ceiling is a property of the SOURCE, not a defect — chasing 55-60 on a thin
    // article is what produced fabricated filler, and it burned three attempts (and
    // three copies of the input) on every single card.
    if (lastWordCount <= MAX_WORDS && lastWordCount >= MIN_USEFUL_WORDS) {
      break;
    }

    // On final retry: accept anything inside the hard ceiling.
    if (attempt === MAX_RETRIES) {
      if (lastWordCount >= MIN_USEFUL_WORDS && lastWordCount <= HARD_MAX_WORDS) {
        logger.warn(
          `Summary word count ${lastWordCount} outside the ${MAX_WORDS}-word limit, accepting after ${MAX_RETRIES} retries`
        );
        break;
      }
      if (lastWordCount > HARD_MAX_WORDS) {
        // Over hard limit — truncate to 60 words
        truncated = true;
        const words = summary.split(/\s+/).filter(Boolean);
        summary = words.slice(0, 60).join(' ');
        if (!summary.endsWith('.')) summary += '.';
        logger.warn(
          `Summary was ${lastWordCount} words — hard-truncated to ${countWords(summary)} words`
        );
        break;
      }
      throw new Error(
        `Summarization failed after ${MAX_RETRIES} retries (last word count: ${lastWordCount})`
      );
    }

    logger.debug(`Attempt ${attempt}: summary was ${lastWordCount} words, retrying...`);
  }

  // Hard safety net: never allow more than HARD_MAX_WORDS
  lastWordCount = countWords(summary);
  if (lastWordCount > HARD_MAX_WORDS) {
    truncated = true;
    const words = summary.split(/\s+/).filter(Boolean);
    summary = words.slice(0, 60).join(' ');
    if (!summary.endsWith('.')) summary += '.';
    logger.warn(`Post-loop safety: truncated from ${lastWordCount} to ${countWords(summary)} words`);
  }

  // Final entity preservation check — log warning but don't block
  const entityCheck = checkEntityPreservation(truncatedText, summary);
  if (!entityCheck.passed) {
    logger.warn(
      `Entity preservation check failed: missing [${entityCheck.missingEntities.join(', ')}]`
    );
  }

  // Generate headline

  // The headline call gets failover too. Wrapping only the summary loop would surface as
  // "summaries fine, headlines 429", which is a confusing way to find a provider is down.
  const { text: headlineText } = await callWithFailover(endpoints, (endpoint) => ({
    ...endpoint.extraBody,
    model: endpoint.model,
    max_tokens: 50,
    messages: [
      {
        role: 'user',
        content: `Write a punchy headline of 6-10 words for this news. Start with a verb or the key entity. Use Title Case — capitalize every word except articles, conjunctions and short prepositions. No quotes, no period at the end. Output only the headline.\n\nTitle: ${title}\n\nSummary: ${summary}`,
      },
    ],
  }));

  const headline = headlineText || title.split(' ').slice(0, 12).join(' ');

  return {
    headline,
    summary,
    signals: {
      attempts,
      wordCount: countWords(summary),
      truncated,
      entitiesPreserved: entityCheck.passed,
      missingEntities: entityCheck.missingEntities,
    },
  };
}
