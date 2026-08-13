import * as Sentry from '@sentry/nextjs';
import posthog from 'posthog-js';

/**
 * PostHog client init. Without this, every capture()/identify() across the app is a
 * silent no-op — the SDK was imported and called in ~18 places but never started, so
 * analytics was dead regardless of the key being set.
 *
 * api_host must be us.i.posthog.com to match the CSP (see next.config.ts). Profiles
 * are created only for users we identify() (signed-in), and history_change gives SPA
 * pageviews across App Router navigations without a manual router listener.
 */
const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: 'history_change',
    capture_pageleave: true,
  });
}

/**
 * Browser error reporting.
 *
 * Separate DSN var from the server on purpose: this one is compiled into the client
 * bundle, so it has to be NEXT_PUBLIC_. A Sentry DSN is safe to expose — it only
 * grants the ability to send events — but the NEXT_PUBLIC_ prefix is what makes that
 * exposure a decision rather than an accident.
 *
 * The CSP in next.config.ts already allows connect-src to https://*.sentry.io.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // Session replay is deliberately off. It is the single biggest addition to bundle
    // size in this SDK, and the feed is one card per viewport — a replay would mostly
    // record scrolling. Revisit if a bug turns up that traces cannot explain.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    sendDefaultPii: false,
  });
}

/** Ties client-side navigations to their traces. No-op when init did not run. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
