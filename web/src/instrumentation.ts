import * as Sentry from '@sentry/nextjs';

/**
 * Server and edge error reporting.
 *
 * next.config.ts already wraps the build in withSentryConfig when SENTRY_DSN is set,
 * which uploads source maps — but nothing ever called Sentry.init, so no error was
 * ever captured. The build half was wired and the runtime half was not.
 *
 * Everything here is a no-op without a DSN, so local development and CI are
 * unchanged and neither needs a Sentry account.
 */
export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,

    // Traces are sampled, errors are not. A feed gets read far more than it breaks,
    // so tracing everything would be mostly cost. Override per environment.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),

    // The service key must never reach an error report. Sentry does not send request
    // bodies or headers by default; this makes that explicit rather than assumed,
    // because there is no RLS behind it — see issue #6.
    sendDefaultPii: false,
  });
}

/**
 * Next 15 routes server-side render and route-handler errors here. Without it, an
 * error thrown inside a Server Component is swallowed by the framework's error
 * boundary and never reaches Sentry. No-op when init did not run.
 */
export const onRequestError = Sentry.captureRequestError;
