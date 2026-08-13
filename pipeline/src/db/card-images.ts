import { supabase } from './client.js';
import type { Category } from '@hexcast/shared';
import type { ImageErrorKind } from '../processors/image-generator.js';
import { POOL_SIZE, poolPath, poolIndexFor } from '../processors/image-pool.js';

/**
 * Storage and bookkeeping for card cover art.
 *
 * The bucket is public-read so the web app can render a plain <img src> with no signing
 * round-trip; writes need the service key, which only the pipeline has.
 */
export const IMAGE_BUCKET = 'card-images';

/**
 * Create the bucket if it is missing.
 *
 * Idempotent, and called at startup rather than left as a documented manual step — a
 * feature whose setup lives only in a README is a feature that breaks on the next
 * environment and takes an afternoon to diagnose.
 */
export async function ensureImageBucket(): Promise<void> {
  const { data } = await supabase.storage.getBucket(IMAGE_BUCKET);
  if (data) return;

  const { error } = await supabase.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: '8MB',
    allowedMimeTypes: ['image/png'],
  });

  // A concurrent run may have created it between the check and the create.
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Failed to create ${IMAGE_BUCKET} bucket: ${error.message}`);
  }
}

export async function uploadCardImage(path: string, png: Buffer): Promise<string> {
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, png, {
    contentType: 'image/png',
    // Overwrite rather than fail. A retry after a half-completed upload should replace the
    // partial object, not stall on a name collision forever.
    upsert: true,
    // Images are immutable once stored and live as long as the card, so let the CDN keep
    // them for the card's whole 90-day life.
    cacheControl: '7776000',
  });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Record the outcome. Exactly one of url / error is set, which the DB also enforces —
 * a row claiming both would be a row that reads as done and as failed at once.
 */
export async function recordImageOutcome(
  cardId: string,
  outcome: { url?: string; error?: ImageErrorKind },
): Promise<void> {
  const { error } = await supabase
    .from('cards')
    .update({
      image_url: outcome.url ?? null,
      image_error: outcome.url ? null : (outcome.error ?? 'unknown'),
      image_attempted_at: new Date().toISOString(),
    })
    .eq('id', cardId);

  if (error) throw new Error(`Failed to record image outcome for ${cardId}: ${error.message}`);
}

/**
 * Which pool images exist, listed once per process rather than per card.
 *
 * Assignment must only ever index into images that ARE there. A URL pointing at a missing
 * object 404s, and the card renders its dither fallback — identical to a card that was never
 * assigned. So the check is real, and caching it keeps a per-card storage call out of the
 * hot path.
 */
const poolCache = new Map<Category, string[]>();

async function availablePoolPaths(category: Category): Promise<string[]> {
  const cached = poolCache.get(category);
  if (cached) return cached;

  const { data } = await supabase.storage.from(IMAGE_BUCKET).list(`pool/${category}`, { limit: 1000 });
  const present = new Set((data ?? []).map((f) => `pool/${category}/${f.name}`));
  const paths = Array.from({ length: POOL_SIZE }, (_, i) => poolPath(category, i)).filter((p) =>
    present.has(p),
  );

  poolCache.set(category, paths);
  return paths;
}

/**
 * The pool image for a card, or null if its category has none yet.
 *
 * Called at card CREATION, which is the whole point. Assigning in a backfill script made
 * "every card has an image" a snapshot rather than a property: the 33 cards present when it
 * ran were imaged, and every card written afterwards came out bare. A feed that has to be
 * re-backfilled to stay correct is not fixed.
 *
 * Null is safe — the card is written without an image and renders the dither, exactly as a
 * card whose category pool has not been generated should.
 */
export async function poolImageUrlFor(category: Category, cardId: string): Promise<string | null> {
  const paths = await availablePoolPaths(category);
  if (paths.length === 0) return null;

  const path = paths[poolIndexFor(cardId, paths.length)];
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
