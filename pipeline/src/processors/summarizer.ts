import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { checkEntityPreservation } from './entity-checker.js';
import { loadConfig } from '../config.js';

// ── AI Client Setup ────────────────────────────────────────────────────

function createClient(): { client: OpenAI; model: string; mode: 'prod' | 'dev' } {
  const config = loadConfig();

  if (config.env === 'prod') {
    return {
      client: new OpenAI({ apiKey: config.openaiApiKey }),
      model: 'gpt-4.1-mini',
      mode: 'prod',
    };
  }

  // Dev: local Ollama
  return {
    client: new OpenAI({ apiKey: 'ollama', baseURL: config.ollamaBaseUrl }),
    model: config.ollamaModel,
    mode: 'dev',
  };
}

// ── Prompts (from PROMPT.md benchmarks) ─────────────────────────────────

// V1 — Best for Ollama (score 81.9, 100% word count compliance)
const SYSTEM_PROMPT_V1 = `You write 60-word news cards for Hexcast, an Ethereum ecosystem digest read by
protocol developers and DeFi professionals. Write like Inshorts: factual, punchy,
zero filler. Every word earns its place.`;

function buildUserPromptV1(content: string): string {
  return `Write exactly 60 words summarizing this content.

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
  return `Summarize this content in exactly 60 words.

Step 1: In a <think> block, list all technical identifiers you MUST preserve:
  - EIP/ERC numbers (e.g., EIP-7702)
  - Version numbers (e.g., v5.4.0)
  - Dollar amounts (e.g., $8.7M)
  - Percentages (e.g., 92.4%)
  - Named authors or entities

Step 2: After </think>, write exactly 60 words incorporating as many identifiers as possible.

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
const MIN_WORDS = 55;
const MAX_WORDS = 60;
const FALLBACK_MIN = 50;
const FALLBACK_MAX = 65;
const HARD_MAX_WORDS = 67; // absolute ceiling — truncate anything above this

// Concurrent-safe rate limiter for OpenAI Mini (Tier 1: 500 RPM)
// Serializes API calls via promise chain so concurrent workers are spaced ≥150ms apart
const MIN_API_INTERVAL_MS = 150; // ~400 RPM max to stay safe
let _rateLimitChain = Promise.resolve();
let _lastApiCallAt = 0;

async function rateLimit(mode: 'prod' | 'dev') {
  if (mode !== 'prod') return;
  // Each caller chains after the previous — ensures serial spacing
  const prev = _rateLimitChain;
  let resolve: () => void;
  _rateLimitChain = new Promise<void>((r) => { resolve = r; });
  await prev;
  const now = Date.now();
  const elapsed = now - _lastApiCallAt;
  if (elapsed < MIN_API_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_API_INTERVAL_MS - elapsed));
  }
  _lastApiCallAt = Date.now();
  resolve!();
}

export async function summarize(
  fullText: string,
  title: string
): Promise<{ headline: string; summary: string }> {
  const { client, model, mode } = createClient();

  logger.debug(`Summarizing with ${mode === 'prod' ? 'GPT-4.1 Mini (V1.3)' : 'Ollama 8B (V1)'}`);

  // Truncate to keep inference fast and within token limits
  const maxChars = mode === 'prod' ? 8000 : 6000;
  const truncatedText =
    fullText.length > maxChars
      ? fullText.slice(0, maxChars) + '\n\n[Content truncated]'
      : fullText;

  // Select prompt based on mode
  const systemPrompt = mode === 'prod' ? SYSTEM_PROMPT_V13 : SYSTEM_PROMPT_V1;
  const buildUserPrompt = mode === 'prod' ? buildUserPromptV13 : buildUserPromptV1;

  let summary = '';
  let lastWordCount = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let prompt = buildUserPrompt(truncatedText);

    // On retry: provide word count feedback
    if (attempt > 1) {
      prompt += `\n\nIMPORTANT: Your previous summary was ${lastWordCount} words. It MUST be between ${MIN_WORDS} and ${MAX_WORDS} words. Count carefully.`;
    }

    // On retry: check entity preservation from previous attempt
    if (attempt > 1 && summary) {
      const entityCheck = checkEntityPreservation(truncatedText, summary);
      if (!entityCheck.passed && entityCheck.missingEntities.length > 0) {
        prompt += `\nYou MUST include these entities: ${entityCheck.missingEntities.join(', ')}`;
      }
    }

    await rateLimit(mode);

    const response = await client.chat.completions.create({
      model,
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    const rawOutput = response.choices[0]?.message?.content?.trim() ?? '';

    // Sanitize in both modes: prod (V1.3) emits a <think> block, and dev models
    // narrate ("Here is a 60-word news card…"). Must happen before the word
    // count, or the enforcement below measures text that never reaches the card.
    summary = extractSummaryText(rawOutput);
    lastWordCount = countWords(summary);

    // Strict range: 58-62 words
    if (lastWordCount >= MIN_WORDS && lastWordCount <= MAX_WORDS) {
      break;
    }

    // On final retry: accept looser range
    if (attempt === MAX_RETRIES) {
      if (lastWordCount >= FALLBACK_MIN && lastWordCount <= FALLBACK_MAX) {
        logger.warn(
          `Summary word count ${lastWordCount} outside strict range (${MIN_WORDS}-${MAX_WORDS}), accepting after ${MAX_RETRIES} retries`
        );
        break;
      }
      if (lastWordCount >= 20 && lastWordCount <= HARD_MAX_WORDS) {
        logger.warn(
          `Summary word count ${lastWordCount} outside target, accepting after ${MAX_RETRIES} retries`
        );
        break;
      }
      if (lastWordCount > HARD_MAX_WORDS) {
        // Over hard limit — truncate to 60 words
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
  await rateLimit(mode);

  const headlineResponse = await client.chat.completions.create({
    model,
    max_tokens: 50,
    messages: [
      {
        role: 'user',
        content: `Write a punchy headline of 6-10 words for this news. Start with a verb or the key entity. Use Title Case — capitalize every word except articles, conjunctions and short prepositions. No quotes, no period at the end. Output only the headline.\n\nTitle: ${title}\n\nSummary: ${summary}`,
      },
    ],
  });

  const headline =
    headlineResponse.choices[0]?.message?.content?.trim() ??
    title.split(' ').slice(0, 12).join(' ');

  return { headline, summary };
}
