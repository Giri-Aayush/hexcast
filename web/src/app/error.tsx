'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // This boundary was catching render errors and only logging them to a console
    // nobody reads in production. Sentry is a no-op without a DSN.
    Sentry.captureException(error);
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6">
      <div className="text-center space-y-4">
        <div
          className="text-[11px] tracking-widest uppercase"
          style={{ color: 'var(--link)' }}
        >
          &gt; something went wrong
        </div>
        <p
          className="text-[13px] tracking-wider"
          style={{ color: 'var(--ink-dim)' }}
        >
          an unexpected error occurred.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 text-[10px] font-medium uppercase tracking-widest transition-all hover:brightness-110 cursor-pointer"
          style={{ background: 'var(--link)', color: '#fff' }}
        >
          try again
        </button>
      </div>
    </main>
  );
}
