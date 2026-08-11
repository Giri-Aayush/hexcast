import { supabase } from './client.js';
import type { Card, Category, EngagementMetrics } from '@hexcast/shared';
import type { QualityBreakdown } from '../processors/quality-scorer.js';
import type { SummarySignals } from '../processors/summarizer.js';

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
}

export async function createCard(params: CreateCardParams): Promise<string> {
  const { data, error } = await supabase.from('cards').insert({
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
