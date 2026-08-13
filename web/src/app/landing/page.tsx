'use client';

/**
 * Marketing landing page, reimplemented from the Claude Design project
 * "Hexcast Landing.dc.html". This is a standalone route (`/landing`) — it is not
 * linked from the app shell, does not touch the feed at `/`, and does not decide
 * final routing. That decision (whether this becomes the new `/`) is still open.
 *
 * The whole page is a client component because most of it is interactive (the
 * live counter, the email signup, the animated headline) and metadata has to come
 * from a server component, so it lives in the sibling `layout.tsx` instead.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import '@/styles/landing.css';

/* ────────────────────────────────────────────────────────────────────────
 * COPY FLAG — read before shipping this page anywhere real.
 *
 * The design doc's hero line and the "WORDS PER CARD" stat both claim a fixed
 * card length ("sixty words" / "60"). That is no longer true: Hexcast cards are
 * honest variable length now, and the app copy elsewhere had "60 words" claims
 * deliberately removed (see commit 2069510, "strip em dashes ... fix stale
 * card-count claims"). This page is built faithfully to the design doc anyway,
 * per instructions, but both claims are pulled from these two constants so
 * fixing them later — once someone decides what the honest replacement copy is
 * — is a one-line change in each place, not a text hunt through JSX.
 * ──────────────────────────────────────────────────────────────────────── */
const HERO_HIGHLIGHT_PHRASE = 'sixty words';
const WORDS_PER_CARD_STAT = '60';

const COUNTER_START = 41180;
const COUNTER_INTERVAL_MS = 4200;
const COUNTER_DIGITS = 5;

type CategoryKey =
  | 'RESEARCH'
  | 'EIP_ERC'
  | 'PROTOCOL_CALLS'
  | 'GOVERNANCE'
  | 'UPGRADE'
  | 'SECURITY'
  | 'ANNOUNCEMENT'
  | 'METRICS';

const CATEGORY_LABEL: Record<CategoryKey, string> = {
  RESEARCH: 'RESEARCH',
  EIP_ERC: 'EIP/ERC',
  PROTOCOL_CALLS: 'PROTOCOL CALLS',
  GOVERNANCE: 'GOVERNANCE',
  UPGRADE: 'UPGRADE',
  SECURITY: 'SECURITY',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  METRICS: 'METRICS',
};

interface DeckCard {
  category: CategoryKey;
  rotate: number;
  y: number;
  headline: string;
  summary: string;
  source: string;
}

const DECK_CARDS: DeckCard[] = [
  {
    category: 'GOVERNANCE',
    rotate: -9,
    y: 52,
    headline: 'Delegate turnout falls to 31% on treasury vote',
    summary:
      'Lowest since the delegate program began; three of the top ten delegates abstained.',
    source: 'FORUM.ENS.DOMAINS · 5H',
  },
  {
    category: 'SECURITY',
    rotate: -5,
    y: 22,
    headline: 'Halcyon Bridge drained for $41M after guardian key rotation',
    summary:
      'A guardian rotation left a five-hour window where the retired 4-of-7 set still validated withdrawals.',
    source: 'REKT.NEWS · 41M',
  },
  {
    category: 'EIP_ERC',
    rotate: -1.5,
    y: 4,
    headline: 'EIP-7702 delegations pass 1.2M accounts',
    summary:
      'Since Pectra activated, 1,214,300 EOAs have set a delegation designation, and 71% point at four contracts.',
    source: 'ETHRESEAR.CH · 3H',
  },
  {
    category: 'UPGRADE',
    rotate: 1.5,
    y: 0,
    headline: 'Glamsterdam devnet-3 activates ePBS on all five clients',
    summary:
      'Builder-attester separation held through a deliberate 30% builder outage; missed slots peaked at 4.1%.',
    source: 'BLOG.ETHEREUM.ORG · 1H',
  },
  {
    category: 'PROTOCOL_CALLS',
    rotate: 5,
    y: 20,
    headline: 'ACDE #221 sets Glamsterdam scope, defers FOCIL',
    summary:
      'Core devs confirmed ePBS and EIP-7732, and gave FOCIL two weeks to land devnet coverage.',
    source: 'ETHEREUM-MAGICIANS.ORG · 6H',
  },
  {
    category: 'METRICS',
    rotate: 9,
    y: 50,
    headline: 'Blob fees hold above 1 gwei for eleven straight days',
    summary:
      'Longest sustained period since blobs launched; rollup posting costs up 18% month over month.',
    source: 'DUNE.COM · 3D',
  },
];

const STATS: { number: string; label: string; desc: string }[] = [
  {
    number: '88',
    label: 'CURATED SOURCES',
    desc:
      'Research forums, client repos, governance portals, audit firms and independent security researchers. Tiered, not weighted by follower count.',
  },
  {
    number: WORDS_PER_CARD_STAT,
    label: 'WORDS PER CARD',
    desc:
      'Numbers, versions and EIP identifiers front-loaded. Every card is complete on its own, no tap required to understand what happened.',
  },
  {
    number: '4s',
    label: 'TO TRIAGE ONE',
    desc:
      'One card per viewport, swipe for the next. Save, vote on accuracy or flag it without leaving the card.',
  },
];

const CATEGORY_TILES: { category: CategoryKey; count: number }[] = [
  { category: 'RESEARCH', count: 14 },
  { category: 'EIP_ERC', count: 9 },
  { category: 'PROTOCOL_CALLS', count: 12 },
  { category: 'GOVERNANCE', count: 9 },
  { category: 'UPGRADE', count: 7 },
  { category: 'SECURITY', count: 11 },
  { category: 'ANNOUNCEMENT', count: 15 },
  { category: 'METRICS', count: 11 },
];

const DOMAIN_CHIPS = [
  'ethresear.ch',
  'notes.ethereum.org',
  'ethereum-magicians.org',
  'eips.ethereum.org',
  'github.com/ethereum/pm',
  'blog.ethereum.org',
  'rekt.news',
  'blog.openzeppelin.com',
  'blog.trailofbits.com',
  'forum.ens.domains',
  'dune.com',
  'paradigm.xyz',
];

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

function smoothScrollTo(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Live counter ─────────────────────────────────────────────────────── */

function DigitCounter() {
  const [value, setValue] = useState(COUNTER_START);

  useEffect(() => {
    const id = setInterval(() => {
      setValue((v) => v + 1);
    }, COUNTER_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const digits = String(value).padStart(COUNTER_DIGITS, '0').split('');

  return (
    <div className="hxl-counter" aria-label={`${value} cards published since launch`}>
      {digits.map((d, i) => (
        <span
          key={i}
          className={`hxl-digit${i === digits.length - 1 ? ' hxl-digit-ones' : ''}`}
        >
          {d}
        </span>
      ))}
    </div>
  );
}

/* ── Email signup ─────────────────────────────────────────────────────── */

function EmailSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'invalid' | 'success'>('idle');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setStatus('invalid');
      return;
    }
    setStatus('success');
  }

  return (
    <form className="hxl-signup" onSubmit={handleSubmit} noValidate>
      <div className="hxl-signup-row">
        <input
          className="hxl-signup-input"
          type="email"
          placeholder="you@protocol.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
        />
        <button type="submit" className="hxl-signup-submit">
          {status === 'success' ? "You're in" : 'Sign up'}
        </button>
      </div>
      <p
        className={
          status === 'invalid'
            ? 'hxl-signup-note hxl-signup-note-error'
            : status === 'success'
              ? 'hxl-signup-note hxl-signup-note-success'
              : 'hxl-signup-note'
        }
      >
        {status === 'invalid' && 'ENTER A VALID EMAIL'}
        {status === 'success' && '08:00 DIGEST CONFIRMED. CHECK YOUR INBOX'}
      </p>
    </form>
  );
}

/* ── Install button ───────────────────────────────────────────────────── */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function InstallButton() {
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // A second, independent listener alongside the app-wide InstallPrompt
    // component: multiple `beforeinstallprompt` listeners are fine, the event
    // fires once and every listener receives it. This one is scoped to this
    // button only and never touches that component's state.
    function handler(e: Event) {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
    }
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleClick() {
    if (!deferred.current) return;
    await deferred.current.prompt();
    deferred.current = null;
  }

  return (
    <button type="button" className="hxl-btn-outline" onClick={handleClick}>
      Install Hexcast
    </button>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="hxl">
      <header className="hxl-header">
        <span className="hxl-wordmark">
          hexcast<span className="hxl-dot">.</span>
        </span>
        <nav className="hxl-nav">
          <a className="hxl-nav-link" href="#sources" onClick={(e) => smoothScrollTo(e, 'sources')}>
            Sources
          </a>
          <a className="hxl-nav-link" href="#how" onClick={(e) => smoothScrollTo(e, 'how')}>
            How it works
          </a>
          <a href="/" className="hxl-btn-pill">
            Open the feed
          </a>
        </nav>
      </header>

      <section className="hxl-hero">
        <span className="hxl-pill">
          <span className="hxl-pill-dot" />
          <span className="hxl-pill-label">88 SOURCES MONITORED</span>
        </span>

        <DigitCounter />
        <span className="hxl-counter-label">CARDS PUBLISHED SINCE LAUNCH</span>

        <h1 className="hxl-h1">
          Every Ethereum development in{' '}
          <span className="hxl-highlight">
            {HERO_HIGHLIGHT_PHRASE}
            <span className="hxl-caret" aria-hidden="true" />
          </span>
          .
        </h1>

        <p className="hxl-sub">
          Protocol research, client releases, governance votes and exploits, read as
          one card per screen. No charts, no threads, no scrolling for the point.
        </p>

        <EmailSignup />

        <div className="hxl-deck" aria-hidden="true">
          <div className="hxl-deck-inner">
            {DECK_CARDS.map((card, i) => (
              <article
                key={i}
                className="hxl-deck-card"
                data-category={card.category}
                style={{ transform: `rotate(${card.rotate}deg) translateY(${card.y}px)` }}
              >
                <div className="hxl-deck-dither" />
                <div className="hxl-deck-badge-row">
                  <span className="hxl-deck-badge">{CATEGORY_LABEL[card.category]}</span>
                </div>
                <div className="hxl-deck-body">
                  <h3 className="hxl-deck-headline">{card.headline}</h3>
                  <p className="hxl-deck-summary">{card.summary}</p>
                  <div className="hxl-deck-source">{card.source}</div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="hxl-section" id="how">
        <p className="hxl-eyebrow">01</p>
        <h2 className="hxl-h2">Signal density, not coverage</h2>
        <div className="hxl-stats">
          {STATS.map((s) => (
            <div className="hxl-stat" key={s.label}>
              <p className="hxl-stat-number">{s.number}</p>
              <p className="hxl-stat-label">{s.label}</p>
              <p className="hxl-stat-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="hxl-section" id="sources">
        <p className="hxl-eyebrow">02</p>
        <h2 className="hxl-h2">Eight categories, one layout</h2>
        <div className="hxl-cats">
          {CATEGORY_TILES.map((tile) => (
            <div className="hxl-cat-tile" key={tile.category} data-category={tile.category}>
              <p className="hxl-cat-name">{CATEGORY_LABEL[tile.category]}</p>
              <p className="hxl-cat-count">{tile.count}</p>
            </div>
          ))}
        </div>
        <div className="hxl-chips">
          {DOMAIN_CHIPS.map((d) => (
            <span className="hxl-chip" key={d}>
              {d}
            </span>
          ))}
          <span className="hxl-chip hxl-chip-more">+ 76 more</span>
        </div>
      </section>

      <div className="hxl-cta">
        <div className="hxl-cta-block">
          <div className="hxl-cta-copy">
            <p className="hxl-cta-eyebrow">INSTALLABLE · OFFLINE · NO ACCOUNT TO READ</p>
            <h2 className="hxl-cta-heading">
              Add it to your home screen and read the last 24 hours on the train.
            </h2>
            <p className="hxl-cta-body">
              Five cards a day without an account. Sign in to save across devices,
              keep your filters, and vote on accuracy.
            </p>
          </div>
          <div className="hxl-cta-actions">
            <a href="/" className="hxl-btn-light">
              Open the feed
            </a>
            <InstallButton />
          </div>
        </div>
      </div>

      <footer className="hxl-footer">
        <span className="hxl-footer-wordmark">hexcast.</span>
        <nav className="hxl-footer-links">
          <a className="hxl-footer-link" href="#sources" onClick={(e) => smoothScrollTo(e, 'sources')}>
            Sources
          </a>
          <a className="hxl-footer-link" href="#how" onClick={(e) => smoothScrollTo(e, 'how')}>
            Method
          </a>
          <a className="hxl-footer-link" href="/about">
            Accuracy policy
          </a>
          <a className="hxl-footer-link" href="https://github.com/Giri-Aayush/hexcast/issues/new">
            Contact
          </a>
        </nav>
        <span className="hxl-footer-note">SUMMARIES ARE MACHINE-GENERATED · FLAG ANY CARD</span>
      </footer>
    </div>
  );
}
