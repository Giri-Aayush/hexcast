import { supabase } from './client.js';
import type { FetchResult, RawItem } from '@hexcast/shared';

/** Why an item produced no card. Persisted so gate changes are recoverable. */
export type SkipReason = 'empty' | 'tooOld' | 'tooThin' | 'duplicate' | 'lowQuality';

export async function insertRawItem(result: FetchResult): Promise<void> {
  const { error } = await supabase
    .from('raw_items')
    .upsert(
      {
        source_id: result.sourceId,
        canonical_url: result.canonicalUrl,
        raw_title: result.rawTitle,
        raw_text: result.rawText,
        raw_metadata: result.rawMetadata,
        published_at: result.publishedAt?.toISOString() ?? null,
      },
      { onConflict: 'canonical_url' }
    );

  if (error) throw new Error(`Failed to insert raw item ${result.canonicalUrl}: ${error.message}`);
}

export async function getUnprocessedItems(): Promise<RawItem[]> {
  // Supabase REST API defaults to 1000 rows — paginate to get all
  const PAGE_SIZE = 1000;
  const allItems: RawItem[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('raw_items')
      .select('*')
      .eq('processed', false)
      .order('fetched_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Failed to fetch unprocessed items: ${error.message}`);
    if (!data || data.length === 0) break;

    allItems.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allItems;
}

/**
 * Mark an item done. `skipReason` records WHY it produced no card, so a later gate
 * change can re-evaluate exactly the items that gate rejected — without it, a fixed
 * gate cannot rescue what the old one already skipped.
 */
export async function markAsProcessed(id: string, skipReason?: SkipReason): Promise<void> {
  const { error } = await supabase
    .from('raw_items')
    .update({ processed: true, skip_reason: skipReason ?? null })
    .eq('id', id);

  if (error) throw new Error(`Failed to mark item ${id} as processed: ${error.message}`);
}
