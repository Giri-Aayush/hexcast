import { loadConfig } from './config.js';
import { getActiveSources, updateLastPolledAt } from './db/sources.js';
import { insertRawItem } from './db/raw-items.js';
import { createFetcher } from './fetchers/index.js';
import { processRawItems, type DrainOrder } from './processors/pipeline.js';
import { acquireLock, releaseLock } from './db/pipeline-lock.js';
import { logger } from './utils/logger.js';

// Fallback api_type resolution for sources where DB api_type is null
const SOURCE_API_TYPE_MAP: Record<string, string> = {
  'defillama.com/stablecoins': 'rest_api',
  'defillama.com/chains': 'rest_api',
  'defillama.com/dexs': 'rest_api',
  'cryptopanic.com/trending': 'cryptopanic',
  'cryptopanic.com/hot': 'cryptopanic',
  'cryptopanic.com/rising': 'cryptopanic',
  'cryptocurrency.cv/news': 'crypto_news_api',
};

function resolveApiType(sourceId: string): string {
  return SOURCE_API_TYPE_MAP[sourceId] ?? '';
}

function parseSourceFilter(args: string[]): string | undefined {
  const sourcesArg = args.find((arg) => arg.startsWith('--sources='));
  if (!sourcesArg) return undefined;
  const value = sourcesArg.split('=')[1];
  return value === 'all' ? undefined : value;
}

const DRAIN_ORDERS: DrainOrder[] = ['auto', 'round-robin', 'oldest-first'];

function parseDrainOrder(args: string[]): DrainOrder {
  const arg = args.find((a) => a.startsWith('--drain='))?.split('=')[1];
  if (!arg) return 'auto';

  const order = DRAIN_ORDERS.find((o) => o === arg);
  if (!order) {
    // Silently defaulting here would look identical to the flag working, which
    // is the same failure mode as npm swallowing it in the first place.
    throw new Error(`Unknown --drain=${arg}. Expected one of: ${DRAIN_ORDERS.join(', ')}`);
  }
  return order;
}

function parseIntervalFilter(args: string[]): { min?: number; max?: number } {
  const minArg = args.find((a) => a.startsWith('--min-interval='));
  const maxArg = args.find((a) => a.startsWith('--max-interval='));
  return {
    min: minArg ? parseInt(minArg.split('=')[1], 10) : undefined,
    max: maxArg ? parseInt(maxArg.split('=')[1], 10) : undefined,
  };
}

// Track active run for graceful shutdown
let activeRunId: string | null = null;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    logger.warn(`Received ${signal} — releasing lock and shutting down`);
    if (activeRunId) {
      await releaseLock(activeRunId, { status: 'failed', errorMessage: `Killed by ${signal}`, itemsFetched: 0, cardsCreated: 0, cardsSkipped: 0, cardsFailed: 0 });
    }
    await logger.flush();
    process.exit(0);
  });
}

async function main() {
  const config = loadConfig();
  const sourceFilter = parseSourceFilter(process.argv);
  const intervalFilter = parseIntervalFilter(process.argv);

  logger.info(`Hexcast Pipeline v${config.pipelineVersion}`);

  // ── Execution lock ──────────────────────────────────────────────────
  const runId = await acquireLock();
  activeRunId = runId;
  if (!runId) {
    logger.info('Another pipeline run is active — exiting gracefully');
    process.exit(0);
  }

  let totalFetched = 0;
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  try {
    logger.info(`Source filter: ${sourceFilter ?? 'all'}`);
    if (intervalFilter.min || intervalFilter.max) {
      logger.info(`Interval filter: min=${intervalFilter.min ?? '-'} max=${intervalFilter.max ?? '-'}`);
    }
    if (config.dryRun) logger.info('DRY RUN mode — no AI calls or card creation');

    // 1. Get active sources
    let sources = await getActiveSources(sourceFilter);

    // Apply interval filtering
    if (intervalFilter.min) {
      sources = sources.filter((s) => s.poll_interval_s >= intervalFilter.min!);
    }
    if (intervalFilter.max) {
      sources = sources.filter((s) => s.poll_interval_s <= intervalFilter.max!);
    }

    logger.info(`Found ${sources.length} active sources`);

    if (sources.length === 0) {
      logger.warn('No sources to process');
      await releaseLock(runId, { status: 'completed', itemsFetched: 0, cardsCreated: 0, cardsSkipped: 0, cardsFailed: 0 });
      return;
    }

    // 2. Fetch phase
    for (const source of sources) {
      try {
        const apiType = source.api_type ?? resolveApiType(source.id);

        const fetcher = createFetcher({
          sourceId: source.id,
          baseUrl: source.base_url,
          apiType,
          lastPolledAt: source.last_polled_at ? new Date(source.last_polled_at) : null,
        });

        const results = await fetcher.fetch();
        logger.info(`Fetched ${results.length} items from ${source.id}`);

        // One malformed item must not cost the rest of the source. cryptocurrency.cv
        // renamed its `url` field to `link`, so every item arrived with no canonical URL,
        // the first insert violated the NOT NULL constraint, and the throw unwound the
        // whole loop — discarding every remaining item from that source and reporting it
        // as a fetch failure. A missing canonical URL is a property of one item; skipping
        // it keeps the other 49.
        let malformed = 0;
        for (const result of results) {
          if (!result.canonicalUrl) {
            malformed++;
            continue;
          }
          await insertRawItem(result);
        }

        if (malformed > 0) {
          logger.warn(
            `${source.id}: skipped ${malformed}/${results.length} items with no canonical URL ` +
              `— the source's response shape has probably changed`,
          );
        }

        totalFetched += results.length - malformed;
        await updateLastPolledAt(source.id);
      } catch (error) {
        logger.error(`Failed to fetch ${source.id}:`, error);
      }
    }

    logger.info(`Fetch phase complete: ${totalFetched} new items`);

    // 3. Process phase
    const result = await processRawItems({ drainOrder: parseDrainOrder(process.argv) });
    processed = result.processed;
    skipped = result.skipped;
    failed = result.failed;

    logger.info('Pipeline run complete');
    logger.info(`  Fetched: ${totalFetched} items`);
    logger.info(`  Processed: ${processed} cards created`);
    logger.info(`  Skipped: ${skipped} (duplicates, empty, or dry run)`);
    logger.info(`  Failed: ${failed}`);

    await releaseLock(runId, {
      status: 'completed',
      itemsFetched: totalFetched,
      cardsCreated: processed,
      cardsSkipped: skipped,
      cardsFailed: failed,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Pipeline failed:', error);

    await releaseLock(runId, {
      status: 'failed',
      itemsFetched: totalFetched,
      cardsCreated: processed,
      cardsSkipped: skipped,
      cardsFailed: failed,
      errorMessage,
    });

    process.exit(1);
  }
}

main()
  .catch((error) => {
    logger.error('Pipeline fatal error:', error);
    return logger.flush().then(() => process.exit(1));
  })
  .then(() => logger.flush());
