import type { RawItem } from '@hexcast/shared';
import { getUnprocessedItems, markAsProcessed } from '../db/raw-items.js';
import { createCard } from '../db/cards.js';
import { normalize } from './normalizer.js';
import { isDuplicate } from './deduplicator.js';
import { classify } from './classifier.js';
import { summarize } from './summarizer.js';
import { scoreQualityBreakdown, shouldAutoSuppress } from './quality-scorer.js';
import { hashUrl } from '../utils/hash.js';
import { loadConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { supabase } from '../db/client.js';

// ── Semaphore for concurrent processing ─────────────────────────────────

class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;

  constructor(private limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next(); // transfer slot to next waiter
    } else {
      this.active--;
    }
  }
}

// ── Drain order ─────────────────────────────────────────────────────────

export type DrainOrder = 'oldest-first' | 'round-robin' | 'auto';

/**
 * How many batches deep the backlog has to be before `auto` switches to
 * round-robin. Three means "the queue has not been keeping up for a few runs",
 * at which point breadth matters more than recency: something is either cold or
 * has been down. Below it, the queue is healthy and recency wins.
 */
const ROUND_ROBIN_BACKLOG_BATCHES = 3;

/**
 * `auto` exists because the flag alone did not reach the thing users see. The
 * 6-hourly cron runs `npm run pipeline` with no arguments, so an opt-in flag
 * meant production kept draining oldest-first and kept starving the same
 * categories we fixed locally. Choosing by backlog depth needs no human to
 * remember anything, and self-corrects after an outage.
 */
function resolveDrainOrder(requested: DrainOrder, backlog: number, batchSize: number): DrainOrder {
  if (requested !== 'auto') return requested;
  return backlog > batchSize * ROUND_ROBIN_BACKLOG_BATCHES ? 'round-robin' : 'oldest-first';
}

/**
 * Reorder a backlog so each pass takes one item per source instead of draining
 * one source to exhaustion.
 *
 * Oldest-first is right for a steady-state feed, where the queue is shallow and
 * recency is what matters. It is wrong for a cold-start backfill: whichever
 * source has the deepest backlog swallows the entire batch, so a category with
 * only a handful of items never gets summarized at all. Round-robin spends the
 * same compute and touches every source on the way.
 *
 * @internal Exported for testing
 */
export function roundRobinBySource(items: RawItem[]): RawItem[] {
  if (items.length <= 1) return items;

  // Insertion order preserves whatever order the caller supplied within a
  // source, so items stay oldest-first inside each queue.
  const bySource = new Map<string, RawItem[]>();
  for (const item of items) {
    const queue = bySource.get(item.source_id);
    if (queue) queue.push(item);
    else bySource.set(item.source_id, [item]);
  }

  const queues = [...bySource.values()];
  const ordered: RawItem[] = [];
  while (ordered.length < items.length) {
    let took = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next) {
        ordered.push(next);
        took = true;
      }
    }
    if (!took) break; // unreachable while queues hold every item, but never spin
  }

  return ordered;
}

// ── Pipeline ────────────────────────────────────────────────────────────

export async function processRawItems(
  options: { drainOrder?: DrainOrder } = {},
): Promise<{ processed: number; skipped: number; failed: number }> {
  const config = loadConfig();
  const allItems = await getUnprocessedItems();
  const requestedOrder = options.drainOrder ?? 'auto';
  const drainOrder = resolveDrainOrder(requestedOrder, allItems.length, config.batchSize);

  // Newest first. This is a news product: on a cold backfill the freshest items must
  // become cards first, or the feed leads with stale material until the queue catches up
  // hours later. Sorting before the round-robin keeps BOTH properties — newest-first
  // within each source, and one item per source per pass for category variety — because
  // roundRobinBySource preserves whatever order it is handed inside each queue.
  const byNewest = [...allItems].sort(
    (a, b) => new Date(b.published_at ?? b.fetched_at).getTime()
      - new Date(a.published_at ?? a.fetched_at).getTime(),
  );

  const queue = drainOrder === 'round-robin' ? roundRobinBySource(byNewest) : byNewest;

  // Batch limiting: only process up to batchSize items per run
  // Remaining items will be picked up in the next pipeline run
  const items = queue.slice(0, config.batchSize);
  const deferred = allItems.length - items.length;

  logger.info(`Processing ${items.length} of ${allItems.length} unprocessed items (batch size: ${config.batchSize})`);
  if (deferred > 0) {
    logger.info(`${deferred} items deferred to next run`);
  }
  logger.info(`Mode: ${config.env === 'prod' ? 'GPT-4.1 Mini (V1.3 prompt)' : 'Ollama 8B (V1 prompt)'}`);
  logger.info(
    requestedOrder === 'auto'
      ? `Drain order: ${drainOrder} (auto — backlog ${allItems.length} vs ${config.batchSize * ROUND_ROBIN_BACKLOG_BATCHES} threshold)`
      : `Drain order: ${drainOrder}`,
  );
  logger.info(`Concurrency: ${config.concurrency} workers`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  // Why things were skipped, not just how many. A run that reports "107 skipped" looks
  // identical whether the gates are working or a misconfigured window is rejecting
  // everything — and the individual reasons are debug-level, which production does not log.
  const skipReasons = { empty: 0, tooOld: 0, tooThin: 0, duplicate: 0, lowQuality: 0, dryRun: 0 };
  const startTime = Date.now();
  const sem = new Semaphore(config.concurrency);

  const processOne = async (item: typeof items[0]) => {
    await sem.acquire();
    try {
      // 1. Normalize
      const normalized = normalize(item);
      if (!normalized) {
        logger.debug(`Skipping item ${item.id}: no meaningful content`);
        await markAsProcessed(item.id);
        skipReasons.empty++;
        skipped++;
        return;
      }

      // 2. Skip anything too old to be news. It stays in raw_items as archive.
      const ageDays =
        (Date.now() - new Date(normalized.publishedAt).getTime()) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays > config.maxSourceAgeDays) {
        logger.debug(`Skipping item ${item.id}: published ${Math.round(ageDays)} days ago`);
        await markAsProcessed(item.id);
        skipReasons.tooOld++;
        skipped++;
        return;
      }

      // 3. Skip sources too thin to summarize honestly. A 14-word source cannot yield
      //    a 60-word factual card; the model fills the gap by inventing, and an
      //    invented fact is worse than a missing card on a product that promises
      //    accuracy. Measured on the real corpus: ~13% of items are under 200 chars.
      //    These stay in raw_items and simply never become cards.
      const sourceChars = normalized.title.length + normalized.fullText.length;
      if (sourceChars < config.minSourceChars) {
        logger.debug(`Skipping item ${item.id}: only ${sourceChars} chars of source`);
        await markAsProcessed(item.id);
        skipReasons.tooThin++;
        skipped++;
        return;
      }

      // 4. Deduplicate
      const duplicate = await isDuplicate(
        normalized.canonicalUrl,
        normalized.title,
        normalized.publishedAt
      );
      if (duplicate) {
        logger.debug(`Skipping duplicate: ${normalized.canonicalUrl}`);
        await markAsProcessed(item.id);
        skipReasons.duplicate++;
        skipped++;
        return;
      }

      // 5. Classify
      const category = classify(normalized.sourceId);

      // 6. Summarize
      if (config.dryRun) {
        logger.info(`[DRY RUN] Would summarize: ${normalized.title}`);
        skipReasons.dryRun++;
        skipped++;
        return;
      }

      const { headline, summary, signals } = await summarize(normalized.fullText, normalized.title);

      // 7. Quality score
      const quality = scoreQualityBreakdown({
        sourceId: normalized.sourceId,
        headline,
        summary,
        author: normalized.author,
        engagement: normalized.engagement,
        signals,
      });
      const qualityScore = quality.score;

      if (shouldAutoSuppress(qualityScore)) {
        logger.info(`Auto-suppressed low-quality card (${qualityScore.toFixed(2)}): "${headline}"`);
        skipReasons.lowQuality++;
        await markAsProcessed(item.id);
        skipped++;
        return;
      }

      // 8. Create card
      const cardId = await createCard({
        sourceId: normalized.sourceId,
        canonicalUrl: normalized.canonicalUrl,
        urlHash: hashUrl(normalized.canonicalUrl),
        category,
        headline,
        summary,
        author: normalized.author,
        publishedAt: normalized.publishedAt,
        engagement: normalized.engagement,
        pipelineVersion: config.pipelineVersion,
        qualityScore,
        quality,
        signals,
      });

      // 9. Queue high-priority items (SECURITY / UPGRADE)
      if (category === 'SECURITY' || category === 'UPGRADE') {
        const { error: hpqError } = await supabase
          .from('high_priority_queue')
          .insert({ card_id: cardId, category });
        if (hpqError) {
          logger.warn(`Failed to queue high-priority card ${cardId}: ${hpqError.message}`);
        } else {
          logger.info(`HIGH PRIORITY: ${category} card queued`);
        }
      }

      await markAsProcessed(item.id);
      processed++;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`Created card: "${headline}" [${category}] (${processed}/${items.length}) [${elapsed}s]`);
    } catch (error) {
      failed++;
      logger.error(`Failed to process item ${item.id} (${item.canonical_url}):`, error);
      // Don't mark as processed — it will be retried next run
    } finally {
      sem.release();
    }
  };

  // Process items concurrently (limited by semaphore)
  await Promise.all(items.map(processOne));

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const throughput = processed > 0 ? (processed / (parseFloat(totalTime) || 1) * 60).toFixed(1) : '0';
  logger.info(`Batch complete in ${totalTime}s — ${processed} processed, ${skipped} skipped, ${failed} failed (${throughput} cards/min)`);
  if (skipped > 0) {
    const breakdown = Object.entries(skipReasons)
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${count} ${reason}`)
      .join(', ');
    logger.info(`Skipped breakdown: ${breakdown}`);
  }

  return { processed, skipped, failed };
}
