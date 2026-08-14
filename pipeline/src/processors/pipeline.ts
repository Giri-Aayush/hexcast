import { randomUUID } from 'node:crypto';
import type { RawItem } from '@hexcast/shared';
import { getUnprocessedItems, markAsProcessed, markManyAsProcessed } from '../db/raw-items.js';
import { createCard, countCardsSince } from '../db/cards.js';
import { poolImageUrlFor } from '../db/card-images.js';
import { normalize } from './normalizer.js';
import { isDuplicate } from './deduplicator.js';
import { classify } from './classifier.js';
import { extractEntities } from './entity-checker.js';
import { summarize } from './summarizer.js';
import { scoreQualityBreakdown, shouldAutoSuppress } from './quality-scorer.js';
import { isHighPriority } from './priority.js';
import { generateImageFor } from './card-image-step.js';
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

  // Declared before the freshness partition below, which retires stale items and must count
  // them. Every skip reason is tallied in one place so the run can report a breakdown rather
  // than a bare "N skipped", which reads identically whether the gates are working or a
  // misconfigured window is rejecting everything.
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const skipReasons = { empty: 0, tooOld: 0, tooThin: 0, duplicate: 0, lowQuality: 0, dryRun: 0 };

  // Stale items are dropped from the QUEUE, not skipped inside the batch.
  //
  // The obvious implementation — let the existing age gate reject them one by one — quietly
  // does not work. The batch is 100 items and the daily cap counts CARDS CREATED, so a batch
  // filled with 100 stale items produces zero cards, consumes the run, and the feed still does
  // not grow. Clearing a 1,500-item backlog that way takes fifteen runs during which nothing
  // is published.
  //
  // So they are partitioned out first and marked processed in bulk, with no LLM call, and the
  // batch is then drawn entirely from items that can actually become cards. One run clears the
  // backlog AND publishes a full batch of today's news.
  const cutoff = Date.now() - config.ingestMaxAgeHours * 3_600_000;
  const isFresh = (item: RawItem) => {
    const published = new Date(item.published_at ?? item.fetched_at).getTime();
    return !Number.isFinite(published) || published >= cutoff;
  };

  const fresh = byNewest.filter(isFresh);
  const stale = byNewest.filter((item) => !isFresh(item));

  if (stale.length > 0) {
    await markManyAsProcessed(stale.map((item) => item.id), 'tooOld');
    skipReasons.tooOld += stale.length;
    skipped += stale.length;
    logger.info(
      `Retired ${stale.length} items older than ${config.ingestMaxAgeHours}h without summarizing them ` +
        `(no LLM cost). ${fresh.length} fresh items remain eligible.`,
    );
  }

  const queue = drainOrder === 'round-robin' ? roundRobinBySource(fresh) : fresh;

  // Daily ceiling, checked BEFORE any LLM call. Every card costs a summarization, so this is
  // the spend cap expressed in the unit that drives the spend. Counted from the database
  // rather than tracked in the process, because the cron runs every 6 hours — four runs that
  // each stayed under a per-run limit would still blow a daily one.
  //
  // UTC, explicitly: the cron runs UTC and fetched_at is timestamptz, so a local-time day
  // boundary would drift with whatever runner picked up the job.

  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const writtenToday = await countCardsSince(startOfUtcDay.toISOString());
  const remainingToday = Math.max(0, config.maxCardsPerDay - writtenToday);

  if (remainingToday === 0) {
    logger.info(
      `Daily cap reached: ${writtenToday} cards already written today (limit ${config.maxCardsPerDay}). ` +
        `Skipping the process phase; ${allItems.length} items stay queued for tomorrow.`,
    );
    return { processed: 0, skipped: 0, failed: 0 };
  }

  // Batch limiting: only process up to batchSize items per run, and never past the day's
  // remaining allowance. Remaining items will be picked up in the next pipeline run.
  const effectiveBatch = Math.min(config.batchSize, remainingToday);
  const items = queue.slice(0, effectiveBatch);
  const deferred = allItems.length - items.length;

  logger.info(
    `Processing ${items.length} of ${allItems.length} unprocessed items ` +
      `(batch size: ${config.batchSize}, daily allowance left: ${remainingToday} of ${config.maxCardsPerDay})`,
  );
  if (deferred > 0) {
    logger.info(`${deferred} items deferred to next run`);
  }
  // Report the model and prompt ACTUALLY configured, not a guess from PIPELINE_ENV.
  //
  // This line used to be a hardcoded fork on env: "GPT-4.1 Mini (V1.3 prompt)" for prod and
  // "Ollama 8B (V1 prompt)" otherwise. Both are now wrong. Production runs DeepSeek V4 Flash
  // on the v1 prompt, so the prod string was false on both counts — and it printed
  // confidently on every run.
  //
  // It cost a real measurement. Local runs printed "Ollama 8B", which happened to be true
  // because dev defaults to Ollama, and it was read as a cosmetic mislabel — so a whole
  // corpus of 8B-written cards was measured and reported as if it described the product
  // (see the correction in figures.ts). A log line that states a fact it does not check is
  // worse than no log line, because it is believed.
  const primary = config.llmProviders[0];
  logger.info(
    `Model: ${primary.model} (${primary.prompt} prompt) via ${primary.baseUrl}` +
      (config.llmProviders.length > 1
        ? `, ${config.llmProviders.length - 1} fallback(s)`
        : ', no fallback'),
  );
  logger.info(
    requestedOrder === 'auto'
      ? `Drain order: ${drainOrder} (auto — backlog ${allItems.length} vs ${config.batchSize * ROUND_ROBIN_BACKLOG_BATCHES} threshold)`
      : `Drain order: ${drainOrder}`,
  );
  logger.info(`Concurrency: ${config.concurrency} workers`);

  // Why things were skipped, not just how many. A run that reports "107 skipped" looks
  // identical whether the gates are working or a misconfigured window is rejecting
  // everything — and the individual reasons are debug-level, which production does not log.
  const startTime = Date.now();
  const sem = new Semaphore(config.concurrency);

  const processOne = async (item: typeof items[0]) => {
    await sem.acquire();
    try {
      // 1. Normalize
      const normalized = normalize(item);
      if (!normalized) {
        logger.debug(`Skipping item ${item.id}: no meaningful content`);
        await markAsProcessed(item.id, 'empty');
        skipReasons.empty++;
        skipped++;
        return;
      }

      // 2. Skip anything too old to be news. It stays in raw_items as archive.
      const ageDays =
        (Date.now() - new Date(normalized.publishedAt).getTime()) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays > config.maxSourceAgeDays) {
        logger.debug(`Skipping item ${item.id}: published ${Math.round(ageDays)} days ago`);
        await markAsProcessed(item.id, 'tooOld');
        skipReasons.tooOld++;
        skipped++;
        return;
      }

      // 3. Skip sources too thin to summarize honestly. A source with no facts cannot
      //    yield a factual card; the model fills the gap by inventing, and an invented
      //    fact is worse than a missing card on a product that promises accuracy.
      //
      //    Length alone is the WRONG test, and using it cost us a whole category. A
      //    DefiLlama metrics item averages 273 characters and 8.3 hard identifiers —
      //    terse by nature, dense with facts, and every one of them was being thrown
      //    away by a 600-character floor. Meanwhile the item this gate exists to catch
      //    has 114 characters and ZERO identifiers. Identifier count separates those two;
      //    character count cannot.
      //
      //    So: long enough OR factual enough. Items failing both stay in raw_items and
      //    never become cards.
      const sourceText = `${normalized.title} ${normalized.fullText}`;
      const sourceChars = normalized.title.length + normalized.fullText.length;
      const identifiers = extractEntities(sourceText).length;
      if (sourceChars < config.minSourceChars && identifiers < config.minSourceIdentifiers) {
        logger.debug(
          `Skipping item ${item.id}: only ${sourceChars} chars and ${identifiers} identifiers`,
        );
        await markAsProcessed(item.id, 'tooThin');
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
        await markAsProcessed(item.id, 'duplicate');
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

      const { headline, summary, stats, signals } = await summarize(normalized.fullText, normalized.title);

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
        await markAsProcessed(item.id, 'lowQuality');
        skipped++;
        return;
      }

      // 8. Create card
      // Cover art is assigned AT CREATION, from the category pool, so every card is imaged
      // the moment it exists. The id is generated here rather than by the database so the
      // pool index can be derived from it and written in the same insert — otherwise the
      // card is live and bare until a second write, and "every card has an image" becomes
      // something a backfill has to keep re-establishing rather than something that is true.
      //
      // Costs nothing: it indexes into images already generated. Null when the category has
      // no pool yet, which renders the dither.
      const newCardId = randomUUID();
      const imageUrl = await poolImageUrlFor(category, newCardId);

      const cardId = await createCard({
        id: newCardId,
        imageUrl,
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
        stats,
      });

      // 9. Queue high-priority items (SECURITY / UPGRADE)
      if (isHighPriority(category)) {
        const { error: hpqError } = await supabase
          .from('high_priority_queue')
          .insert({ card_id: cardId, category });
        if (hpqError) {
          logger.warn(`Failed to queue high-priority card ${cardId}: ${hpqError.message}`);
        } else {
          logger.info(`HIGH PRIORITY: ${category} card queued`);
        }

        // 9b. Per-card cover art. OFF unless explicitly enabled.
        //
        // The launch approach is the reusable category pool
        // (scripts/build-image-pool.ts): ~$2 once, covers every card, and no card text ever
        // reaches the image model. Per-card generation costs ~$0.015 EVERY time a card is
        // written — about $5.85/month at steady state — and only covers cards where motif
        // extraction succeeds.
        //
        // This has to be an explicit flag rather than left wired, because it was already
        // inert on production BY ACCIDENT: the workflow does not pass OPENROUTER_API_KEY, so
        // generateImageFor returned early with a warning. Behaviour that depends on a
        // credential being absent is not a decision, it is a coincidence — and the day
        // someone adds that key for an unrelated reason, per-card billing switches itself on
        // with nothing in the diff to show it.
        //
        // Kept rather than deleted because the story-specific path is a real feature we may
        // turn back on; see the motif work and its tests.
        if (config.perCardImages) {
          await generateImageFor(cardId, category, summary);
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
