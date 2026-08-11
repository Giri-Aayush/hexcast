import * as Sentry from '@sentry/nextjs';

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
