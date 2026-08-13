'use client';

import { usePathname } from 'next/navigation';
import { BottomNav } from '@/components/bottom-nav';
import { FeedbackWidget } from '@/components/feedback-widget';
import { InstallPrompt } from '@/components/install-prompt';
import { SpotlightTour } from '@/components/spotlight-tour';

/**
 * The feed's chrome (bottom nav, feedback widget, install banner, spotlight tour)
 * mounts in the root layout, so it wraps every route. That's correct for the app
 * itself, but /landing is a standalone marketing page (see web/src/app/landing) —
 * it is not part of the app shell, ships its own "Install Hexcast" and "Open the
 * feed" CTAs, and the dark bottom-nav pill has no meaning on a page with no tabs
 * to switch between.
 *
 * This wrapper is the one place that knows about that exception, so none of
 * BottomNav / FeedbackWidget / InstallPrompt / SpotlightTour had to be touched.
 */
export function AppChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/landing')) return null;

  return (
    <>
      <BottomNav />
      <FeedbackWidget />
      <InstallPrompt />
      <SpotlightTour />
    </>
  );
}
