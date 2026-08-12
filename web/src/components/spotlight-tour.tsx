'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@/lib/auth-ui';
import { capture } from '@/lib/posthog';

const STORAGE_KEY = 'hexcast_tour_completed';

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export function SpotlightTour() {
  const { isSignedIn } = useUser();
  const started = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (started.current) return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    let cancelled = false;

    // Wait for cards to render before starting
    const waitForCards = setInterval(() => {
      if (cancelled) { clearInterval(waitForCards); return; }
      const card = document.querySelector('.card-summary');
      if (!card) return;
      clearInterval(waitForCards);
      if (!cancelled) startTour();
    }, 500);

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

    const desktopSteps = [
      {
        element: '#hexcast-logo',
        popover: {
          title: 'Welcome to Hexcast',
          description: 'Ethereum ecosystem intelligence — curated from 61 sources, scored for quality, and condensed to exactly 60 words per item. This tour takes under a minute.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.card-summary h2',
        popover: {
          title: '60 words. No more.',
          description: 'Every card is an AI-generated summary of a real source — EIPs, governance votes, security incidents, client releases. The original source is always one tap away.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '.card-actions',
        popover: {
          title: 'Save, react, report',
          description: 'Bookmark cards to read later. React to help tune the feed. Flag anything that looks wrong — we review every report.',
          side: 'top' as const,
          align: 'start' as const,
        },
      },
      {
        element: '#category-filter',
        popover: {
          title: 'Filter by what matters',
          description: 'Tap any category to see only that signal — EIPs, governance, security, metrics, and more. Tap again to clear.',
          side: 'bottom' as const,
          align: 'start' as const,
        },
      },
      {
        element: '[data-nav="sources"]',
        popover: {
          title: 'Control your sources',
          description: 'Toggle any of 61 sources on or off. Hidden sources never appear in your feed — your feed, your signal.',
          side: 'top' as const,
          align: 'center' as const,
        },
      },
      // Step 6: conditional on auth state
      ...(isSignedIn === false
        ? [
            {
              element: '#sign-in-button',
              popover: {
                title: 'Personalize your feed',
                description: 'Sign in to unlock unseen-first ordering — cards you haven\'t read surface before ones you have. Bookmarks and reactions sync across devices.',
                side: 'bottom' as const,
                align: 'end' as const,
              },
            },
          ]
        : [
            {
              element: '#hexcast-logo',
              popover: {
                title: 'Your feed is personalized',
                description: 'Cards you haven\'t seen yet surface first. Once you\'re caught up, older items appear below.',
                side: 'bottom' as const,
                align: 'start' as const,
              },
            },
          ]),
    ];

    const mobileSteps = [
      {
        popover: {
          title: 'Swipe up to read',
          description: 'Each card is a 60-word summary of real Ethereum news. Swipe up for the next one.',
        },
      },
      {
        popover: {
          title: 'Save and react',
          description: 'Tap the ribbon to bookmark. Use thumbs up or down to react. Tap the blue button to read the source.',
        },
      },
      {
        popover: {
          title: 'Filter your feed',
          description: 'Tap a category above to filter. Go to Sources to toggle individual feeds on or off.',
        },
      },
    ];

    const steps = mobile ? mobileSteps : desktopSteps;

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
