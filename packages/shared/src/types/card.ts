import type { Category } from '../constants/categories.js';

export interface Card {
  id: string;
  source_id: string;
  canonical_url: string;
  url_hash: string;
  category: Category;
  headline: string;
  summary: string;
  author: string | null;
  published_at: string;
  fetched_at: string;
  engagement: EngagementMetrics | null;
  flag_count: number;
  reaction_up_count: number;
  reaction_down_count: number;
  is_suspended: boolean;
  pipeline_version: string;
  /**
   * Up to 3 figure tiles for the card's stat row, or null when the card has fewer
   * than 2 stats worth surfacing. Every value is guaranteed to appear verbatim in
   * the summary (pipeline guard, #55) — the row can only show numbers the source
   * states, never invented ones. Null until the extraction migration populates it,
   * so the render below is invisible on older cards. Optional as well as nullable:
   * until the migration adds the column, `select *` returns no field at all
   * (undefined), not null.
   */
  stats?: CardStat[] | null;
}

export interface CardStat {
  /** The figure, verbatim from the summary, e.g. "1.21M" or "71%". */
  value: string;
  /** 2-4 word uppercase label, e.g. "ACCOUNTS" or "TO 4 CONTRACTS". */
  label: string;
}

export interface EngagementMetrics {
  likes?: number;
  replies?: number;
  views?: number;
}

export interface RawItem {
  id: string;
  source_id: string;
  canonical_url: string;
  raw_title: string | null;
  raw_text: string | null;
  raw_metadata: Record<string, unknown> | null;
  published_at: string | null;
  fetched_at: string;
  processed: boolean;
}

export interface SourceRegistry {
  id: string;
  display_name: string;
  base_url: string;
  api_type: string | null;
  poll_interval_s: number;
  default_category: Category;
  is_active: boolean;
  last_polled_at: string | null;
}

export interface Flag {
  id: string;
  card_id: string;
  reported_at: string;
  reason: string | null;
  resolved: boolean;
  resolution: string | null;
}
