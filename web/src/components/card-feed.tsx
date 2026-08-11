'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/nextjs';
import type { Card as CardType } from '@hexcast/shared';
import { CATEGORY_LABELS } from '@/lib/utils';
import { Card } from './card';
import { capture } from '@/lib/posthog';
import { useReactions } from '@/stores/reactions';
import { useSaved } from '@/stores/saved';
import { usePreferences } from '@/stores/preferences';

interface CardFeedProps {
  initialCards: (CardType & { seen?: boolean })[];
  personalized?: boolean;
  initialUnseenCount?: number;
}

export function CardFeed({ initialCards, personalized, initialUnseenCount }: CardFeedProps) {
  const [cards, setCards] = useState<(CardType & { seen?: boolean })[]>(initialCards);
  const [hasMore, setHasMore] = useState(initialCards.length === 20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [totalUnseenCount, setTotalUnseenCount] = useState(initialUnseenCount ?? 0);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Batch fetch reactions + saved (once per card set, not per card) ──
  const { fetchForCards } = useReactions();
  const { init: initSaved } = useSaved();
  const { isSignedIn } = useUser();
  const { hiddenSources } = usePreferences();

  // Filter out cards from hidden sources
  const hiddenSet = useMemo(() => new Set(hiddenSources), [hiddenSources]);
  const visibleCards = useMemo(
    () => cards.filter(c => !hiddenSet.has(c.source_id)),
    [cards, hiddenSet],
  );

  useEffect(() => {
    if (cards.length > 0) {
      fetchForCards(cards.map(c => c.id));
    }
  }, [cards, fetchForCards]);

  useEffect(() => {
    if (isSignedIn) initSaved();
  }, [isSignedIn, initSaved]);

  // First-time swipe hint
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem('hexcast-swipe-hint');
    if (!seen && initialCards.length > 0) {
      setShowSwipeHint(true);
    }
  }, [initialCards.length]);

  // Dismiss hint on first scroll
  useEffect(() => {
    if (!showSwipeHint) return;
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      setShowSwipeHint(false);
      localStorage.setItem('hexcast-swipe-hint', '1');
    };
    container.addEventListener('scroll', onScroll, { once: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [showSwipeHint]);

  // ── Batch view recording (personalized mode only) ──
  const pendingViewsRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushViews = useCallback(() => {
    if (!personalized || pendingViewsRef.current.size === 0) return;
    const ids = [...pendingViewsRef.current];
    pendingViewsRef.current.clear();

    fetch('/api/card-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_ids: ids }),
    }).catch(() => {
      for (const id of ids) pendingViewsRef.current.add(id);
    });
  }, [personalized]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(flushViews, 3000);
  }, [flushViews]);

  // Flush on page hide / unmount
  useEffect(() => {
    if (!personalized) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushViews();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flushViews();
    };
  }, [personalized, flushViews]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(false);

    try {
      const params = new URLSearchParams();
      if (category) params.set('category', category);

      if (personalized && cards.length > 0) {
        const lastCard = cards[cards.length - 1] as CardType & { seen?: boolean };
        params.set('cursor_seen', String(!!lastCard.seen));
        params.set('cursor_published', lastCard.published_at);
      } else if (!personalized && cards.length > 0) {
        const lastCard = cards[cards.length - 1];
        params.set('cursor', lastCard.published_at);
      }

      const res = await fetch(`/api/cards?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      setCards(prev => {
        const ids = new Set(prev.map(c => c.id));
        return [...prev, ...data.cards.filter((c: { id: string }) => !ids.has(c.id))];
      });
      setHasMore(data.hasMore);

      if (personalized && data.unseenCount !== undefined) {
        setTotalUnseenCount(prev => prev + data.unseenCount);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [cards, hasMore, loading, category, personalized]);

  // Track viewed card IDs to avoid duplicate events
  const viewedRef = useRef(new Set<string>());
  const dwellStartRef = useRef<{ cardId: string; time: number } | null>(null);

  // Store latest callbacks in refs so observer doesn't need to recreate
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const visibleCardsRef = useRef(visibleCards);
  visibleCardsRef.current = visibleCards;
  const scheduleFlushRef = useRef(scheduleFlush);
  scheduleFlushRef.current = scheduleFlush;

  // Track current card + preload near end + analytics
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const currentVisibleCards = visibleCardsRef.current;
        for (const entry of entries) {
          const idx = Number(entry.target.getAttribute('data-index'));
          if (isNaN(idx)) continue;

          if (entry.isIntersecting) {
            setCurrentIndex(idx);
            // Haptic tick on card snap (skip first card)
            if (idx > 0) navigator.vibrate?.(6);
            if (idx >= currentVisibleCards.length - 5) loadMoreRef.current();

            const card = currentVisibleCards[idx];
            if (card && !viewedRef.current.has(card.id)) {
              viewedRef.current.add(card.id);
              capture('card_viewed', {
                card_id: card.id,
                category: card.category,
                position: idx,
              });

              if (personalized) {
                pendingViewsRef.current.add(card.id);
                scheduleFlushRef.current();
              }
            }

            if (card) {
              dwellStartRef.current = { cardId: card.id, time: Date.now() };
            }
          } else {
            const card = currentVisibleCards[idx];
            if (card && dwellStartRef.current?.cardId === card.id) {
              const duration = Math.round((Date.now() - dwellStartRef.current.time) / 1000);
              if (duration >= 1) {
                capture('card_dwell', {
                  card_id: card.id,
                  category: card.category,
                  duration_seconds: duration,
                });
              }
              dwellStartRef.current = null;
            }
          }
        }
      },
      { root: container, threshold: 0.6 }
    );

    const items = container.querySelectorAll('[data-index]');
    items.forEach(item => observer.observe(item));
    return () => observer.disconnect();
  // Re-observe only when the DOM items change (visibleCards length), not on callback changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCards.length, personalized]);

  // Pull-to-refresh
  const touchStartY = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const container = containerRef.current;
    if (container && container.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchEnd = useCallback(async (e: React.TouchEvent) => {
    if (touchStartY.current === null || refreshing) return;
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;

    if (diff > 80) {
      setRefreshing(true);
      capture('feed_refreshed');
      try {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        const res = await fetch(`/api/cards?${params}`);
        if (res.ok) {
          const data = await res.json();
          setCards(data.cards);
          setHasMore(data.hasMore);
          setCurrentIndex(0);
          if (personalized && data.unseenCount !== undefined) {
            setTotalUnseenCount(data.unseenCount);
          }
          containerRef.current?.scrollTo({ top: 0 });
        }
      } catch {
        // Silent fail
      } finally {
        setRefreshing(false);
      }
    }
  }, [category, refreshing, personalized]);

  const handleCategoryChange = useCallback(async (newCategory: string | null) => {
    setCategory(newCategory);
    setCurrentIndex(0);
    setLoading(true);
    setError(false);

    try {
      const params = new URLSearchParams();
      if (newCategory) params.set('category', newCategory);

      const res = await fetch(`/api/cards?${params}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      setCards(data.cards);
      setHasMore(data.hasMore);
      if (personalized && data.unseenCount !== undefined) {
        setTotalUnseenCount(data.unseenCount);
      }
      containerRef.current?.scrollTo({ top: 0 });
    } catch {
      setCards([]);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [personalized]);

  function scrollToTop() {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    setCurrentIndex(0);
  }

  const visibleUnseenCount = useMemo(
    () => visibleCards.filter((c: CardType & { seen?: boolean }) => !c.seen).length,
    [visibleCards],
  );
  const showCaughtUp = personalized && visibleUnseenCount > 0 && visibleUnseenCount < visibleCards.length;

  return (
    <div className="hx-shell fixed inset-0">
      {/* ── App bar, 46px, constant across every view (s3a) ── */}
      <header className="hx-appbar">
        <span id="hexcast-logo" className="hx-wordmark">
          hexcast<span>.</span>
        </span>
        <div className="hx-appbar-right">
          {/* Label and count read as one control: what is filtered, and how many
              cards that leaves. Replaces the old always-visible category strip —
              the design puts category selection in a sheet (s3c) instead. */}
          <button
            className="hx-filter-chip"
            onClick={() => setFilterOpen(true)}
            aria-haspopup="dialog"
            aria-label="Filter by category"
          >
            <span className="hx-filter-label">
              {category ? (CATEGORY_LABELS[category] ?? category).toUpperCase() : 'ALL'}
            </span>
            <span className="hx-filter-sep" aria-hidden="true" />
            <span className="hx-filter-count">{visibleCards.length}</span>
          </button>
          <SignedIn>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'w-8 h-8 rounded-[10px]',
                },
              }}
            />
          </SignedIn>
          <SignedOut>
            <SignInButton mode="modal">
              <button id="sign-in-button" className="hx-avatar" aria-label="Sign in">
                IN
              </button>
            </SignInButton>
          </SignedOut>
        </div>
      </header>

      {/* Pull-to-refresh indicator */}
      {refreshing && (
        <div
          className="shrink-0 flex items-center justify-center py-2"
          style={{ background: 'var(--surface)' }}
        >
          <span className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--link)' }}>
            refreshing
          </span>
        </div>
      )}

      {/* ── Card snap-scroll area ── */}
      <div
        ref={containerRef}
        className="hx-feed snap-container flex-1 min-h-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {visibleCards.map((card, idx) => (
          <Fragment key={card.id}>
            {/* "All caught up" divider between unseen and seen */}
            {showCaughtUp && idx === visibleUnseenCount && (
              <div className="snap-item h-full flex items-center justify-center">
                <div className="text-center space-y-4 px-8">
                  <div
                    className="text-sm font-semibold tracking-widest uppercase"
                    style={{ color: '#2c7a5c' }}
                  >
                    [all caught up]
                  </div>
                  <div
                    className="text-[10px] tracking-wider uppercase"
                    style={{ color: 'var(--ink-dim)' }}
                  >
                    you&apos;ve seen everything above — older cards below
                  </div>
                  <div className="flex items-center gap-3 mt-4 justify-center">
                    <div className="caught-up-line w-16" />
                    <span className="text-[9px] tracking-widest uppercase" style={{ color: 'var(--ink-dim)' }}>archive</span>
                    <div className="caught-up-line w-16" />
                  </div>
                </div>
              </div>
            )}
            <div data-index={idx} className="snap-item h-full">
              <Card card={card} position={{ index: idx + 1, total: visibleCards.length }} />
              {/* Swipe hint on first card */}
              {idx === 0 && showSwipeHint && (
                <div
                  className="absolute bottom-20 left-0 right-0 flex flex-col items-center gap-1 animate-in"
                  style={{ pointerEvents: 'none' }}
                >
                  <span className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--ink-dim)' }}>
                    swipe up for more
                  </span>
                  <span className="text-lg animate-in" style={{ color: 'var(--ink-dim)', animationDelay: '0.3s' }}>
                    ↑
                  </span>
                </div>
              )}
            </div>
          </Fragment>
        ))}

        {loading && (
          <div className="snap-item h-full flex items-center justify-center">
            <CardSkeleton />
          </div>
        )}

        {error && !loading && (
          <div className="snap-item h-full flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="text-[11px] tracking-widest uppercase" style={{ color: '#a3342c' }}>
                [error] failed to load cards
              </div>
              <button
                onClick={loadMore}
                className="btn-cta px-4 py-2.5 text-[10px] font-medium tracking-widest uppercase"
                style={{ background: 'var(--ink)', color: 'var(--surface)', borderRadius: 'var(--radius-control)' }}
              >
                [retry]
              </button>
            </div>
          </div>
        )}

        {!hasMore && visibleCards.length > 0 && (
          <div className="snap-item h-full flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-sm font-medium tracking-widest uppercase" style={{ color: 'var(--ink)' }}>
                [end of feed]
              </div>
              <div className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--ink-dim)' }}>
                no more cards to show
              </div>
            </div>
          </div>
        )}

        {!loading && !error && visibleCards.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-[11px] tracking-widest uppercase" style={{ color: 'var(--ink-dim)' }}>
                [no cards found]
              </div>
              <div className="text-[10px] tracking-wider" style={{ color: 'var(--ink-dim)' }}>
                {category ? 'try removing the category filter' : 'check back later for new intel'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category filter. The design moves this out of a permanent strip and into a
          sheet (s3c) so the app bar stays at 46px and the card gets the height.
          This is the existing filter mounted in that position — the sheet's own
          layout is not built to s3c yet. */}
      {filterOpen && (
        <div
          className="hx-sheet-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Filter by category"
          onClick={() => setFilterOpen(false)}
        >
          <div className="hx-sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="hx-sheet-head">
              <span>FILTER</span>
              <button onClick={() => setFilterOpen(false)} aria-label="Close filter">
                CLOSE
              </button>
            </div>
            <CategoryFilter
              active={category}
              onChange={(cat) => {
                handleCategoryChange(cat);
                setFilterOpen(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Scroll-to-top button */}
      {currentIndex > 2 && (
        <button
          onClick={scrollToTop}
          className="hx-totop fixed z-30 flex items-center justify-center animate-fade-in"
          style={{
            right: '16px',
            bottom: 'calc(64px + max(0.5rem, env(safe-area-inset-bottom)))',
            background: 'var(--ink)',
            color: 'var(--surface)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          ↑
        </button>
      )}
    </div>
  );
}

/* ── Skeleton Card ── */
function CardSkeleton() {
  return (
    <div className="h-full flex flex-col px-5 py-5 animate-in">
      <div className="shrink-0">
        <div className="flex items-center gap-3">
          <div className="skeleton h-4 w-20" style={{ opacity: 0.4 }} />
          <div className="skeleton h-3 w-24" style={{ opacity: 0.3 }} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="skeleton h-3 w-16" style={{ opacity: 0.2 }} />
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center min-h-0 py-6">
        <div className="flex items-center gap-2 mb-4" style={{ color: 'var(--ink-dim)' }}>
          <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
          <span className="text-[9px] tracking-widest uppercase">intel</span>
          <div className="h-px flex-1" style={{ background: 'var(--line)' }} />
        </div>
        <div className="space-y-2 mb-4">
          <div className="skeleton h-6 w-full" style={{ opacity: 0.3 }} />
          <div className="skeleton h-6 w-3/4" style={{ opacity: 0.25 }} />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-4 w-full" style={{ opacity: 0.15 }} />
          <div className="skeleton h-4 w-full" style={{ opacity: 0.15 }} />
          <div className="skeleton h-4 w-2/3" style={{ opacity: 0.15 }} />
        </div>
      </div>
      <div className="shrink-0 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="skeleton h-9 w-32" style={{ opacity: 0.2 }} />
        <div className="flex items-center gap-4 mt-3 pb-14">
          <div className="skeleton h-4 w-14" style={{ opacity: 0.15 }} />
          <div className="skeleton h-4 w-10" style={{ opacity: 0.15 }} />
          <div className="skeleton h-4 w-12" style={{ opacity: 0.15 }} />
        </div>
      </div>
    </div>
  );
}

function CategoryFilter({ active, onChange }: { active: string | null; onChange: (cat: string | null) => void }) {
  const categories = [
    'RESEARCH', 'EIP_ERC', 'PROTOCOL_CALLS', 'GOVERNANCE',
    'UPGRADE', 'ANNOUNCEMENT', 'METRICS', 'SECURITY',
  ];

  const labels: Record<string, string> = {
    RESEARCH: 'Research',
    EIP_ERC: 'EIP/ERC',
    PROTOCOL_CALLS: 'Protocol',
    GOVERNANCE: 'Governance',
    UPGRADE: 'Upgrade',
    ANNOUNCEMENT: 'News',
    METRICS: 'Metrics',
    SECURITY: 'Security',
  };

  return (
    <div id="category-filter" className="flex gap-2 overflow-x-auto scrollbar-hide px-5 pb-2.5">
      {categories.map(cat => {
        const isActive = active === cat;
        return (
          <button
            key={cat}
            onClick={() => {
              const newCat = isActive ? null : cat;
              capture('category_filtered', { category: newCat });
              onChange(newCat);
            }}
            className={`cat-pill whitespace-nowrap px-2.5 py-1 text-[10px] font-medium tracking-widest uppercase ${isActive ? 'cat-pill-active' : ''}`}
            style={{
              background: isActive ? 'var(--ink)' : 'transparent',
              color: isActive ? 'var(--surface)' : 'var(--ink-dim)',
              border: `1px solid ${isActive ? 'var(--ink)' : 'var(--line)'}`,
            }}
          >
            {labels[cat] ?? cat}
          </button>
        );
      })}
    </div>
  );
}
