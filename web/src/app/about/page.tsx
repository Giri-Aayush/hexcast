import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'About — Hexcast',
  description: 'How Hexcast works: 88 curated Ethereum sources, AI-powered 60-word summaries, 8 categories of signal. Open source, no paywall, updated continuously.',
  openGraph: {
    title: 'About — Hexcast',
    description: 'How Hexcast works: 88 curated Ethereum sources, AI-powered 60-word summaries, 8 categories of signal.',
  },
};

export default function AboutPage() {
  return (
    <main className="px-5 md:px-10 lg:px-16 py-6 pb-24 h-dvh overflow-y-auto">
      <h1
        className="text-sm font-semibold tracking-widest uppercase mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        <span className="text-glow-accent" style={{ color: 'var(--accent)' }}>[</span>
        about
        <span className="text-glow-accent" style={{ color: 'var(--accent)' }}>]</span>
      </h1>

      {/* Stats */}
      <div
        className="flex items-center gap-4 text-[10px] tracking-wider uppercase mb-8 py-3 px-4"
        style={{
          border: '1px solid var(--border-medium)',
          color: 'var(--text-secondary)',
          background: 'var(--bg-surface)',
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.04)',
        }}
      >
        <span><span className="text-glow-accent" style={{ color: 'var(--accent)' }}>[88]</span> sources</span>
        <span style={{ color: 'var(--text-muted)' }}>//</span>
        <span><span className="text-glow-accent" style={{ color: 'var(--accent)' }}>[8]</span> categories</span>
        <span style={{ color: 'var(--text-muted)' }}>//</span>
        <span><span className="text-glow-accent" style={{ color: 'var(--accent)' }}>[60]</span> word cards</span>
      </div>

      {/* What is Hexcast */}
      <Section title="what_is_hexcast">
        Hexcast aggregates, curates, and summarises information from across the
        Ethereum ecosystem and delivers it as a feed of 60-word story cards. Each
        card captures one event, proposal, decision, or development — enough context
        to understand what happened and why it matters.
      </Section>

      {/* Data Sources */}
      <Section title="data_sources">
        88 sources across 17 tiers: core protocol research (ethresear.ch, Ethereum
        Magicians), EIP/ERC registries, All Core Devs management, governance forums
        (Optimism, Arbitrum, zkSync, Starknet, Uniswap, Aave, Lido, and more), 10
        Ethereum client release feeds, L2 team blogs, security auditors (Trail of Bits,
        OpenZeppelin, Zellic, Chainalysis, SlowMist, and more), research blogs,
        CryptoPanic trending, DefiLlama on-chain metrics, and community newsletters.
      </Section>

      {/* How It Works */}
      <Section title="how_it_works">
        A data pipeline polls sources on schedules ranging from 30 minutes to 4 hours.
        New items are normalised, deduplicated, classified into 8 categories, and
        summarised by an AI model into exactly 60 words. The resulting cards appear
        in your feed within hours of the original publication.
      </Section>

      {/* Open Source */}
      <Section title="open_source">
        Built with Next.js, Supabase, and TypeScript. MIT License.
      </Section>

      <a
        href="https://github.com/Giri-Aayush/will-find-a-name-later"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-cta inline-flex items-center gap-2 mt-1 mb-8 px-4 py-2.5 text-[10px] font-medium uppercase tracking-widest"
        style={{ background: 'var(--accent)', color: '#fff' }}
      >
        view on github
        <span className="text-[10px]">-&gt;</span>
      </a>

      {/* Report */}
      <Section title="report_issue">
        See an inaccurate card? Tap the [!] flag button on any card to submit a
        report. Flagged cards are reviewed within 24 hours. For bugs or feature
        requests, open an issue on GitHub.
      </Section>

      <a
        href="https://github.com/Giri-Aayush/will-find-a-name-later/issues/new"
        target="_blank"
        rel="noopener noreferrer"
        className="btn-cta inline-flex items-center gap-2 mt-1 mb-8 px-4 py-2.5 text-[10px] font-medium uppercase tracking-widest"
        style={{
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          background: 'transparent',
        }}
      >
        report an issue
        <span className="text-[10px]">-&gt;</span>
      </a>

      {/* Footer */}
      <div className="mt-8 pt-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <p className="text-[9px] tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
          ethereum ecosystem intelligence
        </p>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] tracking-wider text-glow-accent" style={{ color: 'var(--accent)' }}>&gt;</span>
        <span
          className="text-[10px] font-medium tracking-widest uppercase"
          style={{ color: 'var(--text-primary)' }}
        >
          {title}
        </span>
        <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
      </div>
      <p
        className="text-[12px] leading-[1.8] font-light pl-4"
        style={{ color: 'var(--text-secondary)' }}
      >
        {children}
      </p>
    </section>
  );
}
