import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    mockGetUnprocessedItems: vi.fn(),
    mockMarkAsProcessed: vi.fn(),
    mockCreateCard: vi.fn(),
    mockNormalize: vi.fn(),
    mockIsDuplicate: vi.fn(),
    mockClassify: vi.fn(),
    mockSummarize: vi.fn(),
    mockScoreQualityBreakdown: vi.fn(),
    mockShouldAutoSuppress: vi.fn(),
    mockHashUrl: vi.fn(),
    mockLoadConfig: vi.fn(),
    mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockSupabase: { from: vi.fn() },
  };
});

vi.mock('../../db/raw-items.js', () => ({
  getUnprocessedItems: mocks.mockGetUnprocessedItems,
  markAsProcessed: mocks.mockMarkAsProcessed,
}));

vi.mock('../../db/cards.js', () => ({
  createCard: mocks.mockCreateCard,
}));

vi.mock('../normalizer.js', () => ({
  normalize: mocks.mockNormalize,
}));

vi.mock('../deduplicator.js', () => ({
  isDuplicate: mocks.mockIsDuplicate,
}));

vi.mock('../classifier.js', () => ({
  classify: mocks.mockClassify,
}));

vi.mock('../summarizer.js', () => ({
  summarize: mocks.mockSummarize,
}));

vi.mock('../quality-scorer.js', () => ({
  scoreQualityBreakdown: mocks.mockScoreQualityBreakdown,
  shouldAutoSuppress: mocks.mockShouldAutoSuppress,
}));

vi.mock('../../utils/hash.js', () => ({
  hashUrl: mocks.mockHashUrl,
}));

vi.mock('../../config.js', () => ({
  loadConfig: mocks.mockLoadConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('../../db/client.js', () => ({
  supabase: mocks.mockSupabase,
}));

// ── Import under test (after mocks) ─────────────────────────────────────

import { processRawItems, roundRobinBySource } from '../pipeline.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeItem(id: string) {
  return {
    id,
    source_id: 'test',
    canonical_url: `https://example.com/${id}`,
    raw_title: 'Test',
    raw_text: 'Test content',
    raw_metadata: {},
    published_at: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    processed: false,
  };
}

function makeItemFrom(sourceId: string, id: string) {
  return { ...makeItem(id), source_id: sourceId };
}

function makeNormalized(id: string) {
  return {
    sourceId: 'test',
    canonicalUrl: `https://example.com/${id}`,
    title: 'Test Title',
    author: 'test-author',
    publishedAt: new Date(),
    fullText: 'Test full text content for summarization.',
    engagement: { likes: 5 },
    rawMetadata: {},
  };
}

const defaultSignals = {
  attempts: 1,
  wordCount: 58,
  truncated: false,
  entitiesPreserved: true,
  missingEntities: [] as string[],
};

const defaultConfig = {
  batchSize: 100,
  concurrency: 1,
  dryRun: false,
  env: 'dev' as const,
  pipelineVersion: '1.0.0',
};

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default config
  mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig });

  // Default happy-path mocks
  mocks.mockMarkAsProcessed.mockResolvedValue(undefined);
  mocks.mockIsDuplicate.mockResolvedValue(false);
  mocks.mockClassify.mockReturnValue('ANNOUNCEMENT');
  mocks.mockSummarize.mockResolvedValue({
    headline: 'Test Headline',
    summary: 'Test summary text.',
    signals: defaultSignals,
  });
  mocks.mockScoreQualityBreakdown.mockReturnValue({
    score: 0.8,
    sourceWeight: 1,
    contentSignals: 0.9,
    generation: 0.7,
  });
  mocks.mockShouldAutoSuppress.mockReturnValue(false);
  mocks.mockHashUrl.mockReturnValue('abc123hash');
  mocks.mockCreateCard.mockResolvedValue('card-uuid-1');
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('roundRobinBySource', () => {
  it('takes one item per source per pass', () => {
    const items = [
      makeItemFrom('forum', 'f1'),
      makeItemFrom('forum', 'f2'),
      makeItemFrom('forum', 'f3'),
      makeItemFrom('blog', 'b1'),
      makeItemFrom('repo', 'r1'),
    ];

    expect(roundRobinBySource(items).map((i) => i.id)).toEqual(['f1', 'b1', 'r1', 'f2', 'f3']);
  });

  it('keeps the caller order within a source', () => {
    const items = [
      makeItemFrom('forum', 'f1'),
      makeItemFrom('forum', 'f2'),
      makeItemFrom('blog', 'b1'),
      makeItemFrom('blog', 'b2'),
    ];

    const forumOrder = roundRobinBySource(items)
      .filter((i) => i.source_id === 'forum')
      .map((i) => i.id);

    expect(forumOrder).toEqual(['f1', 'f2']);
  });

  it('loses nothing and duplicates nothing', () => {
    const items = [
      makeItemFrom('a', 'a1'),
      makeItemFrom('b', 'b1'),
      makeItemFrom('a', 'a2'),
      makeItemFrom('c', 'c1'),
      makeItemFrom('a', 'a3'),
    ];

    const ordered = roundRobinBySource(items);

    expect(ordered).toHaveLength(items.length);
    expect(new Set(ordered.map((i) => i.id)).size).toBe(items.length);
  });

  it('passes through 0 and 1 item unchanged', () => {
    expect(roundRobinBySource([])).toEqual([]);
    const single = [makeItemFrom('a', 'a1')];
    expect(roundRobinBySource(single)).toBe(single);
  });
});

describe('processRawItems drain order', () => {
  it('leaves a shallow backlog oldest-first, so one deep source can swallow the batch', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, batchSize: 3 });
    mocks.mockGetUnprocessedItems.mockResolvedValue([
      makeItemFrom('forum', 'f1'),
      makeItemFrom('forum', 'f2'),
      makeItemFrom('forum', 'f3'),
      makeItemFrom('blog', 'b1'),
    ]);
    mocks.mockNormalize.mockImplementation((item: { id: string }) => makeNormalized(item.id));

    await processRawItems();

    const summarizedSources = mocks.mockNormalize.mock.calls.map((c) => c[0].source_id);
    expect(summarizedSources).toEqual(['forum', 'forum', 'forum']);
  });

  // The flag alone never reached production: pipeline.yml runs `npm run pipeline`
  // with no arguments, so an opt-in flag left the prod cron starving the same
  // categories. These two pin the depth-based choice that fixes that.
  it('switches to round-robin on its own once the backlog is deep', async () => {
    // batchSize 2, threshold 3 batches = 6; a 7-item backlog crosses it
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, batchSize: 2 });
    mocks.mockGetUnprocessedItems.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => makeItemFrom('forum', `f${i}`)),
      makeItemFrom('blog', 'b1'),
    ]);
    mocks.mockNormalize.mockImplementation((item: { id: string }) => makeNormalized(item.id));

    await processRawItems();

    const sources = mocks.mockNormalize.mock.calls.map((c) => c[0].source_id);
    expect(sources).toEqual(['forum', 'blog']);
  });

  it('honours an explicit oldest-first even when the backlog is deep', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, batchSize: 2 });
    mocks.mockGetUnprocessedItems.mockResolvedValue([
      ...Array.from({ length: 6 }, (_, i) => makeItemFrom('forum', `f${i}`)),
      makeItemFrom('blog', 'b1'),
    ]);
    mocks.mockNormalize.mockImplementation((item: { id: string }) => makeNormalized(item.id));

    await processRawItems({ drainOrder: 'oldest-first' });

    const sources = mocks.mockNormalize.mock.calls.map((c) => c[0].source_id);
    expect(sources).toEqual(['forum', 'forum']);
  });

  it('spreads a capped batch across sources when round-robin is requested', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, batchSize: 3 });
    mocks.mockGetUnprocessedItems.mockResolvedValue([
      makeItemFrom('forum', 'f1'),
      makeItemFrom('forum', 'f2'),
      makeItemFrom('forum', 'f3'),
      makeItemFrom('blog', 'b1'),
      makeItemFrom('repo', 'r1'),
    ]);
    mocks.mockNormalize.mockImplementation((item: { id: string }) => makeNormalized(item.id));

    await processRawItems({ drainOrder: 'round-robin' });

    const summarizedSources = mocks.mockNormalize.mock.calls.map((c) => c[0].source_id);
    expect(summarizedSources).toEqual(['forum', 'blog', 'repo']);
  });
});

describe('processRawItems', () => {
  it('returns zeros when no unprocessed items exist', async () => {
    mocks.mockGetUnprocessedItems.mockResolvedValue([]);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 0 });
    expect(mocks.mockNormalize).not.toHaveBeenCalled();
  });

  it('skips and marks as processed when normalize returns null', async () => {
    const item = makeItem('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(null);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('item-1');
    expect(mocks.mockSummarize).not.toHaveBeenCalled();
  });

  it('skips and marks as processed when duplicate is detected', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockIsDuplicate.mockResolvedValue(true);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('item-1');
    expect(mocks.mockIsDuplicate).toHaveBeenCalledWith(
      normalized.canonicalUrl,
      normalized.title,
      normalized.publishedAt,
    );
    expect(mocks.mockSummarize).not.toHaveBeenCalled();
  });

  it('skips without summarizing or marking as processed in dry run mode', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, dryRun: true });
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(mocks.mockSummarize).not.toHaveBeenCalled();
    // Dry run does NOT call markAsProcessed
    expect(mocks.mockMarkAsProcessed).not.toHaveBeenCalled();
  });

  it('skips and marks as processed when quality score triggers auto-suppress', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockScoreQualityBreakdown.mockReturnValue({ score: 0.1, sourceWeight: 0.5, contentSignals: 0.2, generation: 0.1 });
    mocks.mockShouldAutoSuppress.mockReturnValue(true);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0 });
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('item-1');
    expect(mocks.mockCreateCard).not.toHaveBeenCalled();
    expect(mocks.mockShouldAutoSuppress).toHaveBeenCalledWith(0.1);
  });

  it('processes a full item through all pipeline stages successfully', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });

    // Verify full pipeline was exercised
    expect(mocks.mockNormalize).toHaveBeenCalledWith(item);
    expect(mocks.mockIsDuplicate).toHaveBeenCalledWith(
      normalized.canonicalUrl,
      normalized.title,
      normalized.publishedAt,
    );
    expect(mocks.mockClassify).toHaveBeenCalledWith(normalized.sourceId);
    expect(mocks.mockSummarize).toHaveBeenCalledWith(normalized.fullText, normalized.title);
    expect(mocks.mockScoreQualityBreakdown).toHaveBeenCalledWith({
      sourceId: normalized.sourceId,
      headline: 'Test Headline',
      summary: 'Test summary text.',
      author: normalized.author,
      engagement: normalized.engagement,
      // The generation signals are the whole point of the rework — if the
      // pipeline stops forwarding them the score silently reverts to the old
      // existence-only formula, which is what made it unable to suppress.
      signals: defaultSignals,
    });
    expect(mocks.mockCreateCard).toHaveBeenCalledWith({
      sourceId: normalized.sourceId,
      canonicalUrl: normalized.canonicalUrl,
      urlHash: 'abc123hash',
      category: 'ANNOUNCEMENT',
      headline: 'Test Headline',
      summary: 'Test summary text.',
      author: normalized.author,
      publishedAt: normalized.publishedAt,
      engagement: normalized.engagement,
      pipelineVersion: '1.0.0',
      qualityScore: 0.8,
      // Stored alongside the score so a suppression decision can be explained
      // later — picking a threshold blind is how the old one became unreachable.
      quality: { score: 0.8, sourceWeight: 1, contentSignals: 0.9, generation: 0.7 },
      signals: defaultSignals,
    });
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('item-1');
  });

  it('queues SECURITY category cards to high_priority_queue', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockClassify.mockReturnValue('SECURITY');
    mocks.mockSupabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(mocks.mockSupabase.from).toHaveBeenCalledWith('high_priority_queue');
    expect(mocks.mockSupabase.from('high_priority_queue').insert).toHaveBeenCalledWith({
      card_id: 'card-uuid-1',
      category: 'SECURITY',
    });
    expect(mocks.mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('HIGH PRIORITY: SECURITY card queued'),
    );
  });

  it('queues UPGRADE category cards to high_priority_queue', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockClassify.mockReturnValue('UPGRADE');
    mocks.mockSupabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(mocks.mockSupabase.from).toHaveBeenCalledWith('high_priority_queue');
    expect(mocks.mockSupabase.from('high_priority_queue').insert).toHaveBeenCalledWith({
      card_id: 'card-uuid-1',
      category: 'UPGRADE',
    });
  });

  it('does not queue non-priority categories to high_priority_queue', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockClassify.mockReturnValue('RESEARCH');

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(mocks.mockSupabase.from).not.toHaveBeenCalled();
  });

  it('logs warning but still counts as processed when high_priority_queue insert fails', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockClassify.mockReturnValue('SECURITY');
    mocks.mockSupabase.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        error: { message: 'constraint violation' },
      }),
    });

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0 });
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to queue high-priority card'),
    );
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('item-1');
  });

  it('counts as failed and does not mark as processed when summarize throws', async () => {
    const item = makeItem('item-1');
    const normalized = makeNormalized('item-1');
    mocks.mockGetUnprocessedItems.mockResolvedValue([item]);
    mocks.mockNormalize.mockReturnValue(normalized);
    mocks.mockSummarize.mockRejectedValue(new Error('OpenAI API timeout'));

    const result = await processRawItems();

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 1 });
    expect(mocks.mockMarkAsProcessed).not.toHaveBeenCalled();
    expect(mocks.mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process item item-1'),
      expect.any(Error),
    );
  });

  it('limits processing to batchSize even when more items are available', async () => {
    const items = Array.from({ length: 100 }, (_, i) => makeItem(`item-${i}`));
    mocks.mockLoadConfig.mockReturnValue({ ...defaultConfig, batchSize: 10 });
    mocks.mockGetUnprocessedItems.mockResolvedValue(items);

    // Set up each of the 10 items to be processed successfully
    for (let i = 0; i < 10; i++) {
      mocks.mockNormalize.mockReturnValueOnce(makeNormalized(`item-${i}`));
    }

    const result = await processRawItems();

    expect(result.processed + result.skipped + result.failed).toBe(10);
    expect(mocks.mockNormalize).toHaveBeenCalledTimes(10);
  });

  it('handles mixed results: 1 success, 1 duplicate, 1 failure', async () => {
    const items = [makeItem('success'), makeItem('dup'), makeItem('fail')];
    mocks.mockGetUnprocessedItems.mockResolvedValue(items);

    // Item 1: success
    const normalizedSuccess = makeNormalized('success');
    // Item 2: duplicate
    const normalizedDup = makeNormalized('dup');
    // Item 3: fails during summarize
    const normalizedFail = makeNormalized('fail');

    mocks.mockNormalize
      .mockReturnValueOnce(normalizedSuccess)
      .mockReturnValueOnce(normalizedDup)
      .mockReturnValueOnce(normalizedFail);

    mocks.mockIsDuplicate
      .mockResolvedValueOnce(false) // success
      .mockResolvedValueOnce(true)  // dup
      .mockResolvedValueOnce(false); // fail

    mocks.mockSummarize
      .mockResolvedValueOnce({ headline: 'Good Headline', summary: 'Good summary.' }) // success
      .mockRejectedValueOnce(new Error('API error')); // fail

    const result = await processRawItems();

    expect(result).toEqual({ processed: 1, skipped: 1, failed: 1 });
    // success and dup are marked as processed; fail is not
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('success');
    expect(mocks.mockMarkAsProcessed).toHaveBeenCalledWith('dup');
    expect(mocks.mockMarkAsProcessed).not.toHaveBeenCalledWith('fail');
  });
});
