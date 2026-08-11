'use client';

import { useMemo, useState } from 'react';
import type { SourceRegistry, QualityGrade } from '@hexcast/shared';
import { SOURCE_QUALITY, GRADE_SORT_ORDER } from '@hexcast/shared';
import { usePreferences } from '@/stores/preferences';
import { CATEGORY_LABELS } from '@/lib/utils';

const GRADE_LABEL: Record<QualityGrade, string> = {
  S: 'Core protocol',
  A: 'High signal',
  B: 'Ecosystem',
  C: 'Aggregator',
};

const CATEGORIES = [
  'RESEARCH', 'EIP_ERC', 'PROTOCOL_CALLS', 'GOVERNANCE',
  'UPGRADE', 'ANNOUNCEMENT', 'METRICS', 'SECURITY',
] as const;

type FilterMode = 'grade' | 'category';

export function SourceList({ sources }: { sources: SourceRegistry[] }) {
  const { hiddenSources, toggleHideSource } = usePreferences();
  const [filterMode, setFilterMode] = useState<FilterMode>('grade');
  const [activeGrade, setActiveGrade] = useState<QualityGrade | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const sorted = useMemo(() => {
    let filtered = [...sources];

    if (activeGrade) {
      filtered = filtered.filter(s => (SOURCE_QUALITY[s.id] ?? 'C') === activeGrade);
    }
    if (activeCategory) {
      filtered = filtered.filter(s => s.default_category === activeCategory);
    }

    return filtered.sort((a, b) => {
      const gradeA = SOURCE_QUALITY[a.id] ?? 'C';
      const gradeB = SOURCE_QUALITY[b.id] ?? 'C';
      const diff = GRADE_SORT_ORDER[gradeA] - GRADE_SORT_ORDER[gradeB];
      if (diff !== 0) return diff;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [sources, activeGrade, activeCategory]);

  const gradeCounts = useMemo(() => {
    const counts: Record<QualityGrade, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const s of sources) {
      counts[SOURCE_QUALITY[s.id] ?? 'C']++;
    }
    return counts;
  }, [sources]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sources) {
      counts[s.default_category] = (counts[s.default_category] ?? 0) + 1;
    }
    return counts;
  }, [sources]);

  let lastGrade: QualityGrade | null = null;

  return (
    <div>
      {/* Mode toggle — one segmented control, ink slab on the active half */}
      <div className="hx-seg" role="tablist" aria-label="Group sources by">
        <button
          role="tab"
          aria-selected={filterMode === 'grade'}
          onClick={() => { setFilterMode('grade'); setActiveCategory(null); }}
        >
          BY RANK
        </button>
        <button
          role="tab"
          aria-selected={filterMode === 'category'}
          onClick={() => { setFilterMode('category'); setActiveGrade(null); }}
        >
          BY CATEGORY
        </button>
      </div>

      {/* Filter pills */}
      <div className="hx-pillrow scrollbar-hide">
        {filterMode === 'grade' ? (
          (['S', 'A', 'B', 'C'] as QualityGrade[]).map(grade => (
            <button
              key={grade}
              className="hx-pill"
              aria-pressed={activeGrade === grade}
              onClick={() => setActiveGrade(activeGrade === grade ? null : grade)}
            >
              {grade} · {GRADE_LABEL[grade].toUpperCase()} · {gradeCounts[grade]}
            </button>
          ))
        ) : (
          CATEGORIES.map(cat => {
            const count = categoryCounts[cat] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                className="hx-pill"
                data-category={cat}
                aria-pressed={activeCategory === cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              >
                <span className="hx-pill-mark" aria-hidden="true" />
                {(CATEGORY_LABELS[cat] ?? cat).toUpperCase()} · {count}
              </button>
            );
          })
        )}
      </div>

      <div className="hx-showing">
        SHOWING {sorted.length} OF {sources.length}
      </div>

      {/* Source rows, grouped by grade with hairline dividers */}
      <div className="hx-srcgrid">
        {sorted.map(source => {
          const hidden = hiddenSources.includes(source.id);
          const grade: QualityGrade = SOURCE_QUALITY[source.id] ?? 'C';
          const showDivider = grade !== lastGrade && !activeGrade;
          lastGrade = grade;

          return (
            <div key={source.id} className={showDivider ? 'hx-srcgroup' : undefined}>
              {showDivider && (
                <div className="hx-graderule">
                  <span>{grade}</span>
                  <div aria-hidden="true" />
                  <span>{GRADE_LABEL[grade].toUpperCase()}</span>
                </div>
              )}
              {/* The row takes the category's tinted surface, same construction as
                  the feed card: surface + badge hue, nothing else carries colour. */}
              <div className="hx-src" data-category={source.default_category} data-hidden={hidden}>
                <div className="hx-src-main">
                  <div className="hx-src-name">{source.display_name}</div>
                  <div className="hx-src-meta">
                    {(CATEGORY_LABELS[source.default_category] ?? source.default_category).toUpperCase()}
                    {' · '}
                    {grade === 'S' ? 'TIER 1' : grade === 'A' ? 'TIER 2' : grade === 'B' ? 'TIER 3' : 'TIER 4'}
                  </div>
                </div>
                <button
                  className="hx-switch"
                  role="switch"
                  aria-checked={!hidden}
                  aria-label={`${source.display_name} ${hidden ? 'muted' : 'on'}`}
                  onClick={() => toggleHideSource(source.id)}
                >
                  <span aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
