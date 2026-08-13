import type { Category } from '@hexcast/shared';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';
import { buildImagePrompt } from './image-prompt.js';

/**
 * Cover art for a card.
 *
 * Only high-priority cards get one. At a measured $0.015 per image against $0.00017 for the
 * summary, an image costs about 90x what the news itself costs to produce, so this runs on
 * the ~18% of cards the pipeline already treats as most important rather than on everything.
 *
 * NOTHING HERE IS REPRODUCIBLE. `seed` is accepted and ignored — two calls with the same
 * prompt and the same seed returned different bytes (sha256 2da426b4… vs ada48347…). That
 * is the worst kind of not-working, because nothing errors. Do not plan on regenerating an
 * identical image; there is no way to get one.
 */

/**
 * Measured on the response's own usage.cost field, three separate calls, all exactly
 * $0.015 — against $0.0343 for google/gemini-3.1-flash-lite-image. 2.3x cheaper for
 * indistinguishable output, which halves the only line item in this project that costs real
 * money.
 *
 * It is 11.6s against gemini's 4.6s. At ~2.3 images a day that difference is invisible, and
 * it is not on the reader's critical path — the card is already written and served by the
 * time this runs.
 *
 * Both models return 1376x768 (ratio 1.7917), so despite `aspect_ratio` being accepted here
 * and absent on the chat path, neither gives a true 16:9 and there is no dimension
 * advantage between them.
 */
const DEFAULT_IMAGE_MODEL = 'krea/krea-2-medium-turbo';

/**
 * The dedicated images surface, NOT chat/completions.
 *
 * Worth recording how this was found, because it cost a wrong claim: krea is absent from
 * /models AND from chat/completions, and I concluded from those two that the model did not
 * exist. It does — this third surface serves it. Checking two places is not the same as
 * checking everywhere.
 */
const IMAGE_ENDPOINT = 'https://openrouter.ai/api/v1/images';

/**
 * Why an image failed, as a class rather than the provider's prose.
 *
 * The retry script branches on this. Branching on substrings of provider error text is how
 * such a script quietly stops working the day a provider rewords a message, so the raw
 * text goes to the log and the class goes to the database.
 */
export type ImageErrorKind = 'transient' | 'refused' | 'invalid' | 'unknown';

export interface ImageResult {
  /** PNG bytes, ready to upload. Present only on success. */
  png?: Buffer;
  error?: ImageErrorKind;
  /** What actually happened, for the log. Never stored in the error column. */
  detail?: string;
  costUsd?: number;
}

export function classifyImageError(status: number | undefined, body: string): ImageErrorKind {
  if (status === 429 || (status !== undefined && status >= 500)) return 'transient';
  if (status === undefined) return 'transient'; // timeout, DNS, socket — the network, not us

  // A refusal is a statement about the prompt, so retrying it unchanged burns money to get
  // the same answer. Kept separate from 'invalid' because the fix is different: a refusal
  // means change the words, a 400 means fix the code.
  if (/content.?polic|safety|refus|blocked|violat/i.test(body)) return 'refused';
  if (status === 400 || status === 404 || status === 401 || status === 403) return 'invalid';
  return 'unknown';
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  usage?: { cost?: number };
  /** Present when the model answered in prose instead of drawing — usually a refusal. */
  choices?: Array<{ message?: { content?: string; refusal?: string } }>;
}

/**
 * Pull the PNG out of the response.
 *
 * A model can answer with words instead of an image and still return 200 — a refusal reads
 * as success at the HTTP layer. Treating a missing image as success would store an empty
 * object and mark the card done for its whole 90-day life, so it is classified here.
 */
function extractPng(payload: ImagesResponse): { png?: Buffer; detail?: string } {
  const base64 = payload.data?.[0]?.b64_json;

  if (!base64) {
    const message = payload.choices?.[0]?.message;
    const prose = message?.refusal || message?.content || 'empty';
    return { detail: `no image in response: ${prose.slice(0, 200)}` };
  }

  const png = Buffer.from(base64, 'base64');

  // A handful of bytes is not an image. Cheap to check, and it stops a truncated response
  // from becoming a broken <img> on a card for the next 90 days.
  if (png.length < 1024) return { detail: `decoded image implausibly small: ${png.length} bytes` };

  return { png };
}

/**
 * How much to cut off every edge before storing.
 *
 * The prompt says "no text, no letters" and the model ignores it some of the time. One of
 * the first two real images came back with an illegible handwritten signature scrawled in
 * the bottom-left corner, about 45px wide, 2% in from the left edge. That is the classic
 * generative-image artifact and it is unenforceable at the prompt: nobody reviews 300
 * images, so it ships silently.
 *
 * A blind inset is the only guard that does not depend on the model cooperating or on how
 * the web side happens to crop today. 8% removed that signature with room to spare and
 * costs nothing. Kept after the model switch: text artifacts are a property of image models
 * in general, not of the one that happened to produce that signature.
 *
 * BE HONEST ABOUT WHAT THIS IS: a mitigation, not a fix. Marks cluster at the extreme
 * edges, so most are caught, but a signature drawn further in survives — and no cheap
 * check exists for "is there text in this picture". If artifacts start appearing inboard,
 * the answer is a different model, not a bigger crop.
 */
const EDGE_INSET_PERCENT = 8;

async function cropEdges(png: Buffer): Promise<Buffer> {
  const image = sharp(png);
  const { width, height } = await image.metadata();
  if (!width || !height) return png;

  const dx = Math.round((width * EDGE_INSET_PERCENT) / 100);
  const dy = Math.round((height * EDGE_INSET_PERCENT) / 100);

  return image
    .extract({ left: dx, top: dy, width: width - dx * 2, height: height - dy * 2 })
    .png()
    .toBuffer();
}

export async function generateCardImage(
  category: Category,
  motifs: string[],
  options: {
    apiKey: string;
    model?: string;
    timeoutMs?: number;
    /**
     * Use this prompt instead of building one from category + motifs. The pool builder needs
     * a category-only prompt with its own composition hint, and threading that through the
     * motif path would mean two callers quietly editing each other's prompt.
     */
    promptOverride?: string;
  } = { apiKey: '' },
): Promise<ImageResult> {
  const prompt = options.promptOverride ?? buildImagePrompt(category, motifs);
  const model = options.model ?? process.env.IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL;

  // Generation runs 5-10s on the chosen model but has been seen past a minute on others,
  // and this sits in the per-card critical path. A hung request must not stall the batch.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);

  try {
    const response = await fetch(IMAGE_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
        aspect_ratio: '16:9',
        resolution: '1K',
        // No seed. It is accepted and ignored, and passing one would imply a determinism
        // this path cannot deliver.
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = classifyImageError(response.status, body);
      return { error, detail: `${response.status}: ${body.slice(0, 200)}` };
    }

    const payload = (await response.json()) as ImagesResponse;
    const { png, detail } = extractPng(payload);

    if (!png) return { error: 'refused', detail };

    return { png: await cropEdges(png), costUsd: payload.usage?.cost };
  } catch (error) {
    const aborted = (error as Error)?.name === 'AbortError';
    return {
      error: 'transient',
      detail: aborted ? 'timed out' : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate and store, returning the public URL.
 *
 * Never throws. A card with no image is a card; a card that failed to save because its
 * decoration could not be generated is a bug — and by this point the summary is written
 * and paid for.
 */
export async function generateAndStore(
  cardId: string,
  category: Category,
  motifs: string[],
  deps: {
    apiKey: string;
    upload: (path: string, png: Buffer) => Promise<string>;
    model?: string;
  },
): Promise<{ url?: string; error?: ImageErrorKind }> {
  const result = await generateCardImage(category, motifs, { apiKey: deps.apiKey, model: deps.model });

  if (!result.png) {
    logger.warn(`Image generation failed for ${cardId} (${result.error}): ${result.detail}`);
    return { error: result.error ?? 'unknown' };
  }

  try {
    const url = await deps.upload(`${cardId}.png`, result.png);
    logger.info(
      `Image stored for ${cardId} [${category}] ` +
        `(${(result.png.length / 1024).toFixed(0)}KB, $${(result.costUsd ?? 0).toFixed(4)})`,
    );
    return { url };
  } catch (error) {
    // The image exists but the bucket rejected it. Transient by default — a storage outage
    // is worth retrying, and calling it permanent would mean paying for the image twice.
    logger.warn(`Image upload failed for ${cardId}: ${String(error)}`);
    return { error: 'transient' };
  }
}

export { DEFAULT_IMAGE_MODEL };
