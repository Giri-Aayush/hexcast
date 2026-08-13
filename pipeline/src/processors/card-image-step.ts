import type { Category } from '@hexcast/shared';
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../config.js';
import { extractMotifs } from './motif-extractor.js';
import { generateAndStore } from './image-generator.js';
import { ensureImageBucket, uploadCardImage, recordImageOutcome } from '../db/card-images.js';

/**
 * The per-card cover art step: motifs from the summary, image from the motifs, outcome
 * written back.
 *
 * Wrapped in its own module so pipeline.ts calls one function rather than orchestrating
 * four, and so the whole thing can be reused by the backfill script without copying the
 * sequence — a backfill that generates images slightly differently from the live pipeline
 * is a backfill that produces a visibly different-looking half of the feed.
 *
 * Never throws. The card is already written and paid for by the time this runs.
 */

let bucketReady: Promise<void> | undefined;

/** Once per process, not once per card. */
function ensureBucketOnce(): Promise<void> {
  bucketReady ??= ensureImageBucket();
  return bucketReady;
}

export async function generateImageFor(
  cardId: string,
  category: Category,
  summary: string,
): Promise<void> {
  const config = loadConfig();
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    // Not an error worth failing on, but worth saying out loud once: silently producing no
    // images because a key is missing is how the dead OpenAI key hid for a whole session.
    logger.warn(`OPENROUTER_API_KEY not set — no cover image for ${cardId}`);
    return;
  }

  try {
    await ensureBucketOnce();

    // Motifs come from the same provider chain as everything else, so a fallback that is
    // good enough to write the news is good enough to describe its texture.
    const primary = config.llmProviders[0];
    const client = new OpenAI({ apiKey: primary.apiKey, baseURL: primary.baseUrl });

    const motifs = await extractMotifs(summary, async ({ system, user, maxTokens }) => {
      const response = await client.chat.completions.create({
        ...primary.extraBody,
        model: primary.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return ('choices' in response ? response.choices[0]?.message?.content : '')?.trim() ?? '';
    });

    const outcome = await generateAndStore(cardId, category, motifs, {
      apiKey,
      upload: uploadCardImage,
    });

    await recordImageOutcome(cardId, outcome);
  } catch (error) {
    // Belt and braces: generateAndStore already swallows its own failures, so reaching here
    // means the bucket or the outcome write broke. Still not worth failing the card over.
    logger.warn(`Cover image step failed for ${cardId}: ${String(error)}`);
  }
}
