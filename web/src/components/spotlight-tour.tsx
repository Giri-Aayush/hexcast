'use client';

import { useEffect, useRef } from 'react';
import { capture } from '@/lib/posthog';

const STORAGE_KEY = 'hexcast_tour_completed';

/**
 * First-run product tour. The app is gated behind sign-up (see middleware), so by
 * the time this runs the visitor is always a signed-in, brand-new user landing on
 * the feed — there is no signed-out branch to handle anymore.
 *
 * It walks the whole app in one pass: what a card is, the actions on it, the
 * category filter, and each of the four tabs (Feed / Saved / Sources / You). Every
 * selector below is a real one in the rendered DOM — the previous version waited on
 * `.card-summary` and targeted `.card-actions`, neither of which exists, so the tour
 * silently never started.
 */
function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export function SpotlightTour() {
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (started.current) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    let cancelled = false;

    // The tour only makes sense on the feed, so gate the start on a real card being
    // on screen. This also stops it firing on Saved/Sources/You, where there is no
    // `.hx-headline` — it just times out quietly there.
    const waitForCards = setInterval(() => {
      if (cancelled) { clearInterval(waitForCards); return; }
      if (!document.querySelector('.hx-headline')) return;
      clearInterval(waitForCards);
      if (!cancelled) startTour();
    }, 400);

    const timeout = setTimeout(() => clearInterval(waitForCards), 10000);
    return () => {
      cancelled = true;
      clearInterval(waitForCards);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTour() {
    if (started.current) return;
    started.current = true;

    const { driver } = await import('driver.js');
    // @ts-ignore -- CSS import handled by bundler
    await import('driver.js/dist/driver.css');

    const mobile = isMobile();
    // Feed advances by swipe on touch, scroll on a trackpad/mouse. Say both rather
    // than guess wrong on hybrids.
    const advance = mobile ? 'Swipe up' : 'Scroll up';

    const steps = [
      {
        element: '#hexcast-logo',
        popover: {
          title: 'Welcome to Hexcast',
          description:
            'The Ethereum ecosystem, curated from every source worth reading, scored for quality, and condensed into sixty-word cards. This tour takes under a minute.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.hx-headline',
        popover: {
          title: 'One story per card',
          description: `Each card is a single item of real news: an EIP, a governance vote, a client release, a security incident. ${advance} for the next one.`,
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.hx-summary',
        popover: {
          title: 'Sixty words, no fluff',
          description:
            'An AI-written summary of the original source, self-contained so you never have to click through just to understand what happened.',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.hx-meta',
        popover: {
          title: 'Always sourced',
          description:
            'Every card shows where it came from, the source tier, and how old it is. The original is one tap away when you want the full story.',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-tour="save"]',
        popover: {
          title: 'Save for later',
          description: 'Bookmark a card to come back to it. Saved cards live under the Saved tab and sync across your devices.',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.hx-vote',
        popover: {
          title: 'Tune your feed',
          description:
            'Mark a card Signal or Noise. The feed learns what you want more of, so it gets sharper the more you use it.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '.hx-flag',
        popover: {
          title: 'Something look wrong?',
          description: 'Flag a card that reads as inaccurate. We review every report, and it helps keep the feed honest.',
          side: 'top' as const,
          align: 'end' as const,
        },
      },
      {
        element: '.hx-filter-chip',
        popover: {
          title: 'Filter by category',
          description:
            'Narrow the feed to one signal: EIPs, governance, security, metrics, and more. The number is how many cards match.',
          side: 'bottom' as const,
          align: 'end' as const,
        },
      },
      {
        element: '[data-nav="saved"]',
        popover: {
          title: 'Saved',
          description: 'Everything you bookmarked, in one place.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '[data-nav="sources"]',
        popover: {
          title: 'Sources',
          description: 'Every source we track. Toggle any of them off and it will never show up in your feed again.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '[data-nav="you"]',
        popover: {
          title: 'You',
          description: 'Your account and settings: install the app, manage your data, and sign out.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      {
        element: '[data-nav="feed"]',
        popover: {
          title: `You're all set`,
          description: `${advance} to start reading. You can replay this tour anytime from the You tab.`,
          side: 'top' as const,
          align: 'center' as const,
        },
      },
    ];

    const driverObj = driver({
      showProgress: true,
      animate: true,
      smoothScroll: true,
      allowClose: true,
      overlayColor: 'rgba(0, 0, 0, 0.35)',
      stagePadding: 14,
      stageRadius: 6,
      popoverClass: 'hexcast-tour-popover',
      nextBtnText: 'Next →',
      prevBtnText: '← Back',
      doneBtnText: 'Got it ✓',
      progressText: '{{current}} of {{total}}',
      steps,
      onHighlightStarted: () => {
        const idx = driverObj.getActiveIndex() ?? 0;
        capture('tour_step_viewed', {
          step_number: idx + 1,
          step_name: steps[idx]?.popover?.title ?? '',
        });
      },
      onDestroyStarted: () => {
        localStorage.setItem(STORAGE_KEY, '1');
        if (driverObj.isLastStep()) {
          capture('tour_completed');
        } else {
          const activeIdx = driverObj.getActiveIndex();
          capture('tour_skipped', { step_number: (activeIdx ?? 0) + 1 });
        }
        driverObj.destroy();
      },
    });

    capture('tour_started');
    driverObj.drive();
  }

  return null;
}
