import { supabase } from './client.js';
import type { Card, Category, EngagementMetrics } from '@hexcast/shared';
import type { QualityBreakdown } from '../processors/quality-scorer.js';
import type { SummarySignals } from '../processors/summarizer.js';
import type { Stat } from '../processors/stat-extractor.js';

export interface CreateCardParams {
  sourceId: string;
  canonicalUrl: string;
  urlHash: string;
  category: Category;
  headline: string;
  summary: string;
  author: string | null;
  publishedAt: Date;
  engagement: EngagementMetrics | null;
  pipelineVersion: string;
  qualityScore?: number;
  /** Components behind qualityScore, so a number can be explained after the fact. */
  quality?: QualityBreakdown;
  signals?: SummarySignals;
  /**
   * Supplied by the caller so the pool image can be resolved from it and written in the SAME
   * insert. The column has a gen_random_uuid() default, but letting the database pick means
   * the id only exists after the write — which would force a second UPDATE and leave a window
   * where the card is live and imageless.
   */
  id?: string;
  /** Resolved from the category pool at creation. Null when that pool has no images yet. */
  imageUrl?: string | null;
  /** The card's stat row, or null when the summary had too few figures to fill one. */
  stats?: Stat[] | null;
}

export async function createCard(params: CreateCardParams): Promise<string> {
  const { data, error } = await supabase.from('cards').insert({
    ...(params.id ? { id: params.id } : {}),
    image_url: params.imageUrl ?? null,
    source_id: params.sourceId,
    canonical_url: params.canonicalUrl,
    url_hash: params.urlHash,
    category: params.category,
    headline: params.headline,
    summary: params.summary,
    author: params.author,
    published_at: params.publishedAt.toISOString(),
    engagement: params.engagement,
    pipeline_version: params.pipelineVersion,
    quality_score: params.qualityScore ?? null,
    quality_source_weight: params.quality?.sourceWeight ?? null,
    quality_content: params.quality?.contentSignals ?? null,
    quality_generation: params.quality?.generation ?? null,
    summary_attempts: params.signals?.attempts ?? null,
    summary_truncated: params.signals?.truncated ?? null,
    summary_missing_entities: params.signals?.missingEntities ?? null,
    stats: params.stats ?? null,
  }).select('id').single();

  if (error) throw new Error(`Failed to create card for ${params.canonicalUrl}: ${error.message}`);
  return data.id;
}

export async function findByUrlHash(urlHash: string): Promise<Card | null> {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .eq('url_hash', urlHash)
    .maybeSingle();

  if (error) throw new Error(`Failed to find card by hash: ${error.message}`);
  return data;
}

export async function findByTimeRange(
  from: Date,
  to: Date
): Promise<Array<{ headline: string; published_at: string }>> {
  const { data, error } = await supabase
    .from('cards')
    .select('headline, published_at')
    .gte('published_at', from.toISOString())
    .lte('published_at', to.toISOString());

  if (error) throw new Error(`Failed to find cards in time range: ${error.message}`);
  return data ?? [];
}

/**
 * How many cards have been written since a given instant.
 *
 * Exists for the daily spend cap. Counted from the database rather than tracked in the
 * process, because the cron fires every 6 hours — four runs each under a per-run limit would
 * still blow a daily one.
 */
export async function countCardsSince(sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('cards')
    .select('*', { count: 'exact', head: true })
    .gte('fetched_at', sinceIso);

  if (error) throw new Error(`Failed to count cards since ${sinceIso}: ${error.message}`);
  return count ?? 0;
}
