import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
import { BottomNav } from '@/components/bottom-nav';
import { FeedbackWidget } from '@/components/feedback-widget';
import { ToastProvider } from '@/components/toast';
import { PostHogProvider } from '@/components/posthog-provider';
import { InstallPrompt } from '@/components/install-prompt';
import { SpotlightTour } from '@/components/spotlight-tour';

export const metadata: Metadata = {
  title: 'Hexcast',
  description: 'Ethereum ecosystem intelligence in 60-word cards. Protocol updates, governance votes, security incidents, and client releases from 88 curated sources.',
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
    description: 'Ethereum ecosystem intelligence — 60 words at a time.',
    url: 'https://hexcast.xyz',
    siteName: 'Hexcast',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Hexcast',
    description: 'Ethereum ecosystem intelligence — 60 words at a time.',
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
  return (
    <ClerkProvider>
      <html lang="en">
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
                    description: 'Ethereum ecosystem intelligence — 60 words at a time.',
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
          <link
            href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="antialiased overflow-hidden" style={{ color: 'var(--text-primary)' }}>
          <PostHogProvider>
            {children}
            <BottomNav />
            <FeedbackWidget />
            <InstallPrompt />
            <SpotlightTour />
            <ToastProvider />
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
