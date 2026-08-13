'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import Link from 'next/link';
import { SignedIn, SignedOut, SignInButton, useUser } from '@/lib/auth-ui';
import { useSaved } from '@/stores/saved';
import { CATEGORY_LABELS, extractDomain, relativeTime } from '@/lib/utils';

/**
 * Saved is a list, not a feed: compact rows on the category tint, per the design's
 * saved screen. The full card belongs in the feed where it has the viewport to
 * itself; here density is the point.
 */
function SavedCards() {
  const { isSignedIn } = useUser();
  const { savedCards, initialized, init, toggleSave } = useSaved();

  useEffect(() => {
    if (isSignedIn) init();
  }, [isSignedIn, init]);

  if (!initialized) {
    return <div className="hx-quiet">LOADING</div>;
  }

  if (savedCards.length === 0) {
    return (
      <div className="hx-empty">
        <div className="hx-empty-rule" aria-hidden="true" />
        <h2>Nothing saved yet</h2>
        <p>Tap the bookmark on any card and it lands here.</p>
        <Link href="/feed" className="hx-btn-ink">
          Back to feed
        </Link>
      </div>
    );
  }

  return (
    <div className="hx-savedgrid">
      {savedCards.map(card => (
        <div key={card.id} className="hx-saved" data-category={card.category}>
          <div className="hx-saved-top">
            <span>{(CATEGORY_LABELS[card.category] ?? card.category).toUpperCase()}</span>
            <button onClick={() => toggleSave(card.id, card)} aria-label={`Remove ${card.headline} from saved`}>
              REMOVE
            </button>
          </div>
          <Link href={`/card/${card.id}`} className="hx-saved-headline">
            {card.headline}
          </Link>
          <div className="hx-saved-meta">
            {extractDomain(card.canonical_url).toUpperCase()} · {relativeTime(card.published_at).toUpperCase()}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SavedPage() {
  const { savedCards, initialized } = useSaved();

  return (
    <main className="hx-page">
      <header className="hx-page-head">
        <h1>Saved</h1>
        {initialized && savedCards.length > 0 && (
          <span className="hx-page-count">{savedCards.length}</span>
        )}
      </header>

      <SignedIn>
        <SavedCards />
      </SignedIn>

      <SignedOut>
        <div className="hx-empty">
          <div className="hx-empty-rule" aria-hidden="true" />
          <h2>Saved cards follow you</h2>
          <p>An account keeps your saved cards across devices and remembers your filters.</p>
          <SignInButton mode="modal">
            <button className="hx-btn-ink">Sign in</button>
          </SignInButton>
        </div>
      </SignedOut>
    </main>
  );
}
