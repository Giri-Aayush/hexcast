import type { Metadata } from 'next';
import { getSources } from '@/lib/queries';
import { SourceList } from '@/components/source-list';

export const metadata: Metadata = {
  title: 'Sources · Hexcast',
  description: 'All 88 Ethereum sources Hexcast monitors: protocol forums, client repos, governance portals, security researchers, L2 blogs, and on-chain metrics.',
  openGraph: {
    title: 'Sources · Hexcast',
    description: 'All 88 Ethereum sources Hexcast monitors across 17 tiers.',
  },
};

export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const sources = await getSources();
  return (
    <main className="hx-page">
      <header className="hx-page-head">
        <h1>Sources</h1>
        <span className="hx-page-count">
          {sources.length} · 8 CATEGORIES
        </span>
      </header>
      <SourceList sources={sources} />
    </main>
  );
}
