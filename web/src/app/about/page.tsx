import type { Metadata } from 'next';
import { YouPanel } from '@/components/you-panel';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Active monitored-source count, so the "N sources" copy below never goes stale
    as sources are added. Falls back to 88 (the launch count) on any error. */
async function getSourceCount(): Promise<number> {
  const { count, error } = await supabase
    .from('source_registry')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);
  return error ? 88 : count ?? 88;
}

export const metadata: Metadata = {
  title: 'You · Hexcast',
  description: 'Your Hexcast account, plus how Hexcast works: curated Ethereum sources, AI-written summaries, 8 categories of signal. Open source, no paywall.',
  openGraph: {
    title: 'You · Hexcast',
    description: 'How Hexcast works: curated Ethereum sources, AI-written summaries, 8 categories of signal.',
  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hx-about-section">
      <h2>{title}</h2>
      <p>{children}</p>
    </section>
  );
}

export default async function YouPage() {
  const sources = await getSourceCount();
  return (
    <main className="hx-page">
      <div className="hx-you-wrap">
        <header className="hx-you-head">
          <h1>You</h1>
          <p>Your account, and how Hexcast works.</p>
        </header>

        <YouPanel />

        <div className="hx-about">
          <div className="hx-about-grid">
            <Section title="WHAT IS HEXCAST">
              Hexcast aggregates, curates, and summarises information from across the
              Ethereum ecosystem and delivers it as a feed of short story cards. Each
              card captures one event, proposal, decision, or development, with enough
              context to understand what happened and why it matters.
            </Section>

            <Section title="DATA SOURCES">
              {sources} curated sources: core protocol research, EIP/ERC registries,
              All Core Devs management, governance forums, Ethereum client release
              feeds, L2 team blogs, security auditors, research blogs, CryptoPanic
              trending, DefiLlama on-chain metrics, and community newsletters.
            </Section>

            <Section title="HOW IT WORKS">
              A data pipeline polls sources on schedules ranging from 30 minutes to 4
              hours. New items are normalised, deduplicated, classified into 8
              categories, and summarised by an AI model into a short, self-contained
              card. Cards appear in your feed within hours of the original publication.
            </Section>

            <Section title="REPORT AN ISSUE">
              See an inaccurate card? Flag it from the card itself. Flagged cards are
              reviewed, and enough independent flags take a card out of the feed. For
              bugs or feature requests, open an issue on GitHub.
            </Section>
          </div>

          <div className="hx-about-links">
            <a
              className="hx-btn-ink"
              href="https://github.com/Giri-Aayush/hexcast"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
            <a
              className="hx-btn-quiet"
              href="https://github.com/Giri-Aayush/hexcast/issues/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Report an issue
            </a>
          </div>

          <footer className="hx-about-foot">ETHEREUM ECOSYSTEM INTELLIGENCE · MIT</footer>
        </div>
      </div>
    </main>
  );
}
