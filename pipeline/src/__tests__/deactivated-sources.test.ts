import { describe, it, expect } from 'vitest';
import { ALL_SOURCES, DEACTIVATED_SOURCES } from '@hexcast/shared';

describe('DEACTIVATED_SOURCES', () => {
  it('only names sources that exist in the registry', () => {
    // A typo or a renamed source id would silently stop deactivating anything —
    // the seed would mark nothing inactive and we would quietly resume polling a
    // dead endpoint. There is no runtime error to catch that, so it is pinned here.
    const known = new Set(ALL_SOURCES.map((s) => s.id));
    const unknown = Object.keys(DEACTIVATED_SOURCES).filter((id) => !known.has(id));

    expect(unknown).toEqual([]);
  });

  it('gives every deactivated source a non-empty reason', () => {
    // The reason is the only record of why, and the next person deciding whether
    // to re-enable a source has nothing else to go on.
    for (const [id, reason] of Object.entries(DEACTIVATED_SOURCES)) {
      expect(reason.trim().length, `${id} has an empty reason`).toBeGreaterThan(0);
    }
  });
});
