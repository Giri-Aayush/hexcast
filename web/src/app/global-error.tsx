'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

/**
 * Catches errors thrown by the root layout itself, which error.tsx sits inside and
 * therefore cannot catch. This is the only boundary that sees them, so without it a
 * layout-level crash shows the browser's default error screen and reports nothing.
 *
 * It replaces the root layout when it renders, so globals.css never loads and the
 * design tokens are unavailable — hence the literal colours. They are the same values
 * as --bg-deep, --text-primary, --accent and --text-muted.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: '#06060a',
          color: '#ededf0',
          fontFamily: "ui-monospace, 'IBM Plex Mono', Menlo, monospace",
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          margin: 0,
          padding: '0 24px',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#3b82f6',
              marginBottom: '14px',
            }}
          >
            &gt; hexcast failed to load
          </div>
          <p style={{ fontSize: '13px', letterSpacing: '0.05em', color: '#484858', margin: '0 0 22px' }}>
            this one is on us, and it has been reported.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              background: '#3b82f6',
              color: '#fff',
              padding: '10px 18px',
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            reload the feed
          </a>
        </div>
      </body>
    </html>
  );
}
