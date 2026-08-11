'use client';

import { useEffect } from 'react';
import { SignedIn, SignedOut, SignInButton, SignOutButton, useUser } from '@clerk/nextjs';
import { useSaved } from '@/stores/saved';
import { usePreferences } from '@/stores/preferences';

const TOTAL_SOURCES = 88;

/**
 * Identity block + stat row for the You page, per the design's You screen — but
 * only the stats we genuinely track. The design also shows digest and quiet-hours
 * toggles; those have no backend, and a switch that does nothing is worse than no
 * switch.
 */
export function YouPanel() {
  const { user } = useUser();
  const { savedCards, initialized, init } = useSaved();
  const { hiddenSources } = usePreferences();

  useEffect(() => {
    if (user) init();
  }, [user, init]);

  const initials =
    (user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '') ||
    user?.primaryEmailAddress?.emailAddress?.slice(0, 2).toUpperCase() ||
    '··';

  return (
    <>
      <SignedIn>
        <div className="hx-you-id">
          <span className="hx-you-avatar">{initials.toUpperCase()}</span>
          <div>
            <div className="hx-you-name">
              {user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}
            </div>
            <div className="hx-you-sub">
              READER{user?.createdAt ? ` · SINCE ${new Date(user.createdAt).getFullYear()}` : ''}
            </div>
          </div>
        </div>

        <div className="hx-statrow">
          <div>
            <span>{initialized ? savedCards.length : '–'}</span>
            <span>SAVED</span>
          </div>
          <div>
            <span>{TOTAL_SOURCES - hiddenSources.length}</span>
            <span>SOURCES ON</span>
          </div>
          <div>
            <span>8</span>
            <span>CATEGORIES</span>
          </div>
        </div>

        <SignOutButton>
          <button className="hx-btn-quiet">Sign out</button>
        </SignOutButton>
      </SignedIn>

      <SignedOut>
        <div className="hx-empty" style={{ paddingTop: 24 }}>
          <div className="hx-empty-rule" aria-hidden="true" />
          <h2>You&apos;re reading signed out</h2>
          <p>An account saves cards across devices, remembers your filters, and lets you vote on accuracy.</p>
          <SignInButton mode="modal">
            <button className="hx-btn-ink">Sign in</button>
          </SignInButton>
        </div>
      </SignedOut>
    </>
  );
}
