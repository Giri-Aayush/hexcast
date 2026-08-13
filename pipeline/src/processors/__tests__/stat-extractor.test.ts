import { describe, it, expect, vi } from 'vitest';
import { extractStats, validateStats } from '../stat-extractor.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// A real card summary, used throughout so the tests argue about actual output rather than
// a fixture invented to make them pass.
const SUMMARY =
  'USDD circulating supply hit $1.51B on 2026-08-12, up 6.50% in 24h. Price: $0.9991. ' +
  'Tron holds $1.23B, Ethereum $260.5M, BSC $16.6M. Supply spans 4 chains.';

describe('validateStats', () => {
  it('keeps pairs whose value appears verbatim in the summary', () => {
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'SUPPLY' },
        { value: '6.50%', label: '24H CHANGE' },
        { value: '4', label: 'CHAINS' },
      ],
      SUMMARY,
    );

    expect(stats).toEqual([
      { value: '$1.51B', label: 'SUPPLY' },
      { value: '6.50%', label: '24H CHANGE' },
      { value: '4', label: 'CHAINS' },
    ]);
  });

  it('drops a value the summary never states rather than correcting it', () => {
    // The whole point of the feature. A stat row is displayed in large type, so a figure
    // that is not in the summary would be the least verified number on the card.
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'SUPPLY' },
        { value: '$9.99B', label: 'MARKET CAP' },
        { value: '6.50%', label: '24H CHANGE' },
      ],
      SUMMARY,
    );

    expect(stats.map((s) => s.value)).toEqual(['$1.51B', '6.50%']);
  });

  it('drops a reformatted value even though it means the same number', () => {
    // "1,510,000,000" is arithmetically $1.51B and still gets dropped: once the row is
    // allowed to restate a figure its own way, nothing distinguishes a unit conversion
    // from a hallucination, and no check downstream can tell them apart.
    const stats = validateStats(
      [
        { value: '1,510,000,000', label: 'SUPPLY' },
        { value: '6.5%', label: '24H CHANGE' },
        { value: '$0.9991', label: 'PRICE' },
      ],
      SUMMARY,
    );

    // 6.5% is dropped too — the summary writes 6.50%, and near-enough is exactly the
    // judgement this check exists to refuse.
    expect(stats).toEqual([]);
  });

  it('returns nothing when only one pair survives, because one stat is not a row', () => {
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'SUPPLY' },
        { value: '$9.99B', label: 'INVENTED' },
      ],
      SUMMARY,
    );

    expect(stats).toEqual([]);
  });

  it('caps the row at three even when the model returns more', () => {
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'SUPPLY' },
        { value: '6.50%', label: 'CHANGE' },
        { value: '$0.9991', label: 'PRICE' },
        { value: '$1.23B', label: 'ON TRON' },
        { value: '4', label: 'CHAINS' },
      ],
      SUMMARY,
    );

    expect(stats).toHaveLength(3);
    expect(stats.map((s) => s.value)).toEqual(['$1.51B', '6.50%', '$0.9991']);
  });

  it('drops a repeated value so the row cannot show the same number twice', () => {
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'SUPPLY' },
        { value: '$1.51B', label: 'TOTAL' },
        { value: '4', label: 'CHAINS' },
      ],
      SUMMARY,
    );

    expect(stats.map((s) => s.value)).toEqual(['$1.51B', '4']);
  });

  it('drops a label too long for a fixed-width column instead of truncating it', () => {
    // A label ellipsed into "TOTAL CIRCULATING SU…" reads as a rendering bug. Dropping the
    // pair loses one stat; keeping it breaks the row.
    const stats = validateStats(
      [
        { value: '$1.51B', label: 'TOTAL CIRCULATING SUPPLY ACROSS ALL CHAINS' },
        { value: '6.50%', label: '24H CHANGE' },
        { value: '4', label: 'CHAINS' },
      ],
      SUMMARY,
    );

    expect(stats.map((s) => s.label)).toEqual(['24H CHANGE', 'CHAINS']);
  });

  it('ignores malformed entries without throwing', () => {
    const stats = validateStats(
      [null, 'nonsense', 42, { value: '$1.51B' }, { label: 'ORPHAN' }, { value: '', label: 'EMPTY' }, { value: '4', label: 'CHAINS' }, { value: '6.50%', label: 'CHANGE' }],
      SUMMARY,
    );

    expect(stats).toEqual([
      { value: '4', label: 'CHAINS' },
      { value: '6.50%', label: 'CHANGE' },
    ]);
  });
});

describe('extractStats', () => {
  it('does not call the model when the summary has too few figures', async () => {
    // The cost argument for the feature. ~40% of real cards land here.
    const complete = vi.fn();

    const stats = await extractStats('Ethereum core developers agreed to delay the fork.', complete);

    expect(stats).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not count dates as figures when deciding whether to call', async () => {
    // "May 07, 2025 at 10:05 UTC" is four numbers and zero stats. Counting them would
    // spend a call on a summary that cannot produce a row.
    const complete = vi.fn();

    const stats = await extractStats(
      'Pectra ships on May 07, 2025 at 10:05 UTC after a long testnet period.',
      complete,
    );

    expect(stats).toBeNull();
    expect(complete).not.toHaveBeenCalled();
  });

  it('parses a clean JSON array', async () => {
    const complete = vi.fn().mockResolvedValue(
      '[{"value":"$1.51B","label":"SUPPLY"},{"value":"6.50%","label":"24H CHANGE"}]',
    );

    const stats = await extractStats(SUMMARY, complete);

    expect(stats).toEqual([
      { value: '$1.51B', label: 'SUPPLY' },
      { value: '6.50%', label: '24H CHANGE' },
    ]);
  });

  it('parses through code fences and preamble', async () => {
    // Models do this despite being told not to, and a provider swap changes which quirk
    // shows up — so the parser finds the array rather than trusting the format.
    const complete = vi.fn().mockResolvedValue(
      'Here are the stats:\n```json\n[{"value":"$1.51B","label":"SUPPLY"},{"value":"4","label":"CHAINS"}]\n```',
    );

    const stats = await extractStats(SUMMARY, complete);

    expect(stats).toEqual([
      { value: '$1.51B', label: 'SUPPLY' },
      { value: '4', label: 'CHAINS' },
    ]);
  });

  it('parses through a reasoning block', async () => {
    const complete = vi.fn().mockResolvedValue(
      '<think>The supply figure and the chain count are the headline numbers.</think>\n' +
        '[{"value":"$1.51B","label":"SUPPLY"},{"value":"4","label":"CHAINS"}]',
    );

    const stats = await extractStats(SUMMARY, complete);

    expect(stats?.map((s) => s.value)).toEqual(['$1.51B', '4']);
  });

  it('returns null on unparseable output', async () => {
    const complete = vi.fn().mockResolvedValue('I could not find any statistics.');

    expect(await extractStats(SUMMARY, complete)).toBeNull();
  });

  it('returns null when the model returns an empty array', async () => {
    const complete = vi.fn().mockResolvedValue('[]');

    expect(await extractStats(SUMMARY, complete)).toBeNull();
  });

  it('returns null rather than throwing when the call fails', async () => {
    // A card with no stat row is a card. A card that failed to save because its decoration
    // could not be computed is a bug — the summary is already paid for by this point.
    const complete = vi.fn().mockRejectedValue(new Error('429 rate limited'));

    expect(await extractStats(SUMMARY, complete)).toBeNull();
  });

  it('drops a range the model split into two values', async () => {
    // Observed on a live run: "Reth v2.5.0 improves execution performance by 5-10%" came
    // back as separate 5% and 10% stats. Neither number is a claim the summary makes on
    // its own, so both are dropped and the card gets no row — losing a stat is the correct
    // trade against printing a figure in 32px type that the card's own text never states.
    const summary = 'Reth v2.5.0 improves execution performance by 5-10% with reduced latency.';
    const complete = vi.fn().mockResolvedValue(
      '[{"value":"5%","label":"MIN GAIN"},{"value":"10%","label":"MAX GAIN"}]',
    );

    expect(await extractStats(summary, complete)).toBeNull();
  });

  it('keeps a range copied whole', async () => {
    const summary = 'Reth v2.5.0 improves execution performance by 5-10% with reduced latency.';
    const complete = vi.fn().mockResolvedValue(
      '[{"value":"5-10%","label":"FASTER"},{"value":"v2.5.0","label":"RELEASE"}]',
    );

    expect(await extractStats(summary, complete)).toEqual([
      { value: '5-10%', label: 'FASTER' },
      { value: 'v2.5.0', label: 'RELEASE' },
    ]);
  });

  it('returns null when every extracted stat fails the verbatim check', async () => {
    const complete = vi.fn().mockResolvedValue(
      '[{"value":"1.51 billion","label":"SUPPLY"},{"value":"6.5 percent","label":"CHANGE"}]',
    );

    expect(await extractStats(SUMMARY, complete)).toBeNull();
  });
});
