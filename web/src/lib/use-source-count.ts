'use client';

import { useEffect, useState } from 'react';

/**
 * Active monitored-source count, fetched live from /api/stats/cards so the copy
 * never goes stale as sources are added — the failure mode of the old hardcoded
 * "88 sources" strings. Falls back to `fallback` (88, the count at launch) until
 * the fetch resolves, and stays there on any error rather than flashing a 0.
 */
export function useSourceCount(fallback = 88): number {
  const [sources, setSources] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/stats/cards', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.sources === 'number') setSources(d.sources);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return sources ?? fallback;
}
