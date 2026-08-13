import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Hexcast: Every Ethereum development, one card at a time',
  description:
    'Protocol research, client releases, governance votes and exploits from 88 curated sources, read as one card per screen. No charts, no threads, no scrolling for the point.',
  openGraph: {
    title: 'Hexcast',
    description: 'Every Ethereum development, one card at a time. 88 curated sources, 8 categories.',
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
