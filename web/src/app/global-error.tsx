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
 * as the ground, ink, link and dim tokens.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          background: '#e9e8e4',
          color: '#101014',
          fontFamily: "'Geist', system-ui, sans-serif",
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
              color: '#2f6bcc',
              marginBottom: '14px',
            }}
          >
            &gt; hexcast failed to load
          </div>
          <p style={{ fontSize: '13px', letterSpacing: '0.05em', color: '#5c5c64', margin: '0 0 22px' }}>
            this one is on us, and it has been reported.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              background: '#101014',
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
