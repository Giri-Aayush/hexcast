import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppChrome } from '@/components/app-chrome';
import { ToastProvider } from '@/components/toast';
import { PostHogProvider } from '@/components/posthog-provider';

export const metadata: Metadata = {
  title: 'Hexcast',
  description: 'Ethereum ecosystem intelligence in short, self-contained cards. Protocol updates, governance votes, security incidents, and client releases from 88 curated sources.',
  manifest: '/manifest.json',
  metadataBase: new URL('https://hexcast.xyz'),
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [
      { url: '/icons/icon-192.png', sizes: '192x192' },
    ],
  },
  openGraph: {
    title: 'Hexcast',
    description: 'Ethereum ecosystem intelligence, one card at a time.',
    url: 'https://hexcast.xyz',
    siteName: 'Hexcast',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hexcast',
    description: 'Ethereum ecosystem intelligence, one card at a time.',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Hexcast',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#08080c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning on html and body: browser extensions inject into head
  // and body before React hydrates — an Aztec wallet extension adds an inpage
  // script, ColorZilla adds cz-shortcut-listen — and React reports the first
  // divergent node rather than the cause. Verified in a clean headless browser:
  // zero hydration warnings. This only silences attribute mismatches on these two
  // elements, not anything inside the app.
  return (
      <html lang="en" suppressHydrationWarning>
        <head>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@graph': [
                  {
                    '@type': 'WebSite',
                    '@id': 'https://hexcast.xyz/#website',
                    url: 'https://hexcast.xyz',
                    name: 'Hexcast',
                    description: 'Ethereum ecosystem intelligence, one card at a time.',
                    publisher: { '@id': 'https://hexcast.xyz/#organization' },
                  },
                  {
                    '@type': 'Organization',
                    '@id': 'https://hexcast.xyz/#organization',
                    name: 'Hexcast',
                    url: 'https://hexcast.xyz',
                    logo: {
                      '@type': 'ImageObject',
                      url: 'https://hexcast.xyz/icons/icon-512.png',
                      width: 512,
                      height: 512,
                    },
                    sameAs: ['https://github.com/Giri-Aayush/hexcast'],
                  },
                ],
              }),
            }}
          />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          {/* Geist + Geist Mono, the faces the design is drawn in. Loaded the same
              way the design doc loads them, because neither is in next/font/google
              and the `geist` package cannot be installed while node_modules is
              shared between the two agent worktrees. The CSP already allows
              fonts.googleapis.com and fonts.gstatic.com.
              IBM Plex Mono stays until the last component stops reading the old
              --font-mono. */}
          <link
            href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body suppressHydrationWarning className="antialiased overflow-hidden" >
          <PostHogProvider>
            {children}
            <AppChrome />
            <ToastProvider />
          </PostHogProvider>
        </body>
      </html>
  );
}
