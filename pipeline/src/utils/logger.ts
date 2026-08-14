import * as Sentry from '@sentry/node';

// ── Sentry init (optional — only active when SENTRY_DSN is set) ──────────
const sentryEnabled = !!process.env.SENTRY_DSN;

if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.PIPELINE_ENV ?? 'dev',
    tracesSampleRate: 0.1,
  });
}

// ── Logger ────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function log(level: LogLevel, message: string, ...args: unknown[]) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (args.length > 0) {
    console[level === 'error' ? 'error' : 'log'](prefix, message, ...args);
  } else {
    console[level === 'error' ? 'error' : 'log'](prefix, message);
  }

  // Forward errors and warnings to Sentry
  if (sentryEnabled && level === 'error') {
    const error = args.find((a) => a instanceof Error);
    if (error) {
      Sentry.captureException(error, { extra: { message } });
    } else {
      Sentry.captureMessage(message, 'error');
    }
  }
  if (sentryEnabled && level === 'warn') {
    Sentry.captureMessage(message, 'warning');
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
  flush: async () => {
    if (sentryEnabled) await Sentry.flush(5000);
  },
  /**
   * Flush AND shut down, releasing the transport.
   *
   * Sentry.flush sends pending events but leaves the client running, so its background handles
   * can keep the Node event loop alive. Closing is the correct cleanup for a batch job either
   * way — but note this is NOT a confirmed diagnosis of the two-hour production hang. I tried
   * to reproduce that locally with SENTRY_DSN set and the old code still exited in 11 seconds,
   * so Sentry is a candidate and not the established cause. See the exit handling in index.ts,
   * which is the part that actually guarantees termination.
   */
  close: async () => {
    if (sentryEnabled) await Sentry.close(5000);
  },
};
