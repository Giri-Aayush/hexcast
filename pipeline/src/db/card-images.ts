import { supabase } from './client.js';
import type { ImageErrorKind } from '../processors/image-generator.js';

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
