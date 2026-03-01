'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/nextjs';
import { useSaved } from '@/stores/saved';
import { Card } from '@/components/card';

function SavedCards() {
  const { isSignedIn } = useUser();
  const { savedCards, initialized, init } = useSaved();

  useEffect(() => {
    if (isSignedIn) init();
  }, [isSignedIn, init]);

  if (!initialized) {
    return (
      <div className="py-12 text-center text-[11px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>
        <span className="cursor-blink">loading...</span>
      </div>
    );
  }

  if (savedCards.length === 0) {
    return (
      <div className="py-20 flex flex-col items-center text-center">
        <svg width="28" height="38" viewBox="0 0 22 30" fill="none" className="mb-5 opacity-30">
          <path
            d="M0 0H22V30L11 23L0 30V0Z"
            stroke="var(--text-muted)"
            strokeWidth="1"
          />
          <path
            d="M8 10L10 12L14 8"
            stroke="var(--text-muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="text-[12px] tracking-widest uppercase mb-3" style={{ color: 'var(--text-secondary)' }}>
          [no saved cards yet]
        </div>
        <p className="text-[11px] leading-relaxed max-w-xs" style={{ color: 'var(--text-muted)' }}>
          Tap the bookmark icon on any card to save it here for quick access later.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {savedCards.map(card => (
        <div
          key={card.id}
          className="card-ambient p-4 md:p-5"
          data-category={card.category}
          style={{
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-card)',
          }}
        >
          <Card card={card} />
        </div>
      ))}
    </div>
  );
}

export default function SavedPage() {
  return (
    <main className="px-5 md:px-10 lg:px-16 py-6 pb-24 h-dvh overflow-y-auto">
      <h1
        className="text-sm font-semibold tracking-widest uppercase mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        <span className="text-glow-accent" style={{ color: 'var(--accent)' }}>[</span>
        saved
        <span className="text-glow-accent" style={{ color: 'var(--accent)' }}>]</span>
      </h1>

      <SignedIn>
        <SavedCards />
      </SignedIn>

      <SignedOut>
        <div className="py-16 text-center">
          <div className="text-[11px] tracking-widest uppercase mb-6" style={{ color: 'var(--text-muted)' }}>
            [authentication required]
          </div>
          <p className="text-[12px] mb-6" style={{ color: 'var(--text-secondary)' }}>
            Sign in to save cards and access them across devices.
          </p>
          <SignInButton mode="modal">
            <button
              className="btn-cta inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-medium uppercase tracking-widest"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              sign in
              <span className="text-[10px]">-&gt;</span>
            </button>
          </SignInButton>
        </div>
      </SignedOut>
    </main>
  );
}
