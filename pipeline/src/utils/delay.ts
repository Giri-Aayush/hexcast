/**
 * Politeness delay between requests to the same upstream source.
 *
 * Fetchers space their requests out so we don't hammer a forum or an API. Unit
 * tests drive those same code paths, so the suite sat in real sleeps — 2s per
 * CryptoPanic page, 1s per Discourse topic, 500ms per crypto-news page, 200ms
 * per DefiLlama chain. On an idle machine that fits inside vitest's 5s default;
 * on a loaded one it does not, and tests started failing with timeouts that read
 * exactly like broken code. That cost a false verdict on a green branch.
 *
 * FETCH_DELAY_SCALE keeps production spacing intact while letting the suite set
 * it to 0. Scaling rather than a boolean so it can also be dialled down (0.1)
 * when manually poking at a fetcher.
 */
const scale = Number(process.env.FETCH_DELAY_SCALE ?? '1');
const FETCH_DELAY_SCALE = Number.isFinite(scale) && scale >= 0 ? scale : 1;

export function delay(ms: number): Promise<void> {
  const scaled = ms * FETCH_DELAY_SCALE;
  if (scaled <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, scaled));
}
