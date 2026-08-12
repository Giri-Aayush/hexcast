/**
 * Feed card cap for the dev environment (#59).
 *
 * MAX_FEED_CARDS caps the whole feed to a fixed number of cards — the dev deploy
 * sets it to 10 for a small, stable testing set; main/prod leaves it unset for the
 * full infinite-scroll product. Identical code on both, differing only by this env
 * var, so dev and main never diverge (#58).
 *
 * Server-side only: the feed server-renders and /api/cards is a server route, so
 * this is never NEXT_PUBLIC and never reaches the client bundle.
 */

/** The cap, or null when unset (full product). Parsed once per request. */
export function feedCap(): number | null {
  const raw = process.env.MAX_FEED_CARDS;
  if (!raw) return null;
  const n = Number(raw);
  // A malformed value means the feed silently ran uncapped — treat it as unset
  // rather than crashing, but a 0 or negative is a real misconfig, so floor at 1.
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * Clamp a requested page size to the cap. When capped, the first page is the only
 * page, so the cap is enforced statelessly — no cursor accounting needed.
 */
export function cappedLimit(requested: number): number {
  const cap = feedCap();
  return cap === null ? requested : Math.min(requested, cap);
}

/** True when the feed is capped — the caller forces hasMore=false so loadMore stops. */
export function isCapped(): boolean {
  return feedCap() !== null;
}
