<div align="center">

# `[ hexcast ]`

**Ethereum ecosystem intelligence — 60 words at a time.**

[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-live-22c55e?style=flat-square)]()
[![Sources](https://img.shields.io/badge/sources-88-3b82f6?style=flat-square)]()
[![Categories](https://img.shields.io/badge/categories-8-3b82f6?style=flat-square)]()
[![Built with Next.js](https://img.shields.io/badge/Next.js-15-0c0c14?style=flat-square&logo=next.js&logoColor=3b82f6)](https://nextjs.org)

<br/>

> Protocol updates. Governance votes. Security incidents. Client releases.<br/>
> Every signal that moves the Ethereum ecosystem — one card, 60 words, always free.

<br/>

**[→ hexcast.xyz](https://hexcast.xyz)** &nbsp;·&nbsp; [Documentation](#how-it-works) &nbsp;·&nbsp; [Report an Issue](https://github.com/Giri-Aayush/hexcast/issues)

</div>

---

## The problem with Ethereum news

Most Ethereum coverage falls into one of two failure modes:

**Too broad** — general crypto outlets covering price action, not protocol mechanics. Governance votes and EIP status changes disappear beneath token price articles.

**Too slow** — curated newsletters publish once a week. By the time you read it, the All Core Devs call was five days ago and the Arbitrum vote already closed.

Week in Ethereum News filled this gap. It retired in January 2025. Hexcast picks up where it left off.

---

## What Hexcast is

**Hexcast** is an Ethereum ecosystem intelligence platform. The **Hexcast Feed** is what users see — a real-time stream of quality-scored, AI-summarized 60-word cards built for people who build on Ethereum.

The platform monitors 88 curated sources across 17 tiers — protocol research forums, client repositories, governance portals, security researchers, L2 team blogs, audit firms — and surfaces every significant development as a card in the Hexcast Feed. Updated continuously. Zero paywall. No email required.

```
88 sources  →  quality filter  →  60-word AI summary  →  hexcast feed
```

---

## Eight categories of signal

| Category | What it tracks |
|---|---|
| `RESEARCH` | Protocol proposals, EIPs in progress, core researcher posts, ethresear.ch threads |
| `EIP / ERC` | New proposals, status transitions (Draft → Review → Final), merges to main — bot noise filtered out |
| `PROTOCOL CALLS` | All Core Devs agendas and summaries, consensus/execution layer decision logs |
| `GOVERNANCE` | DAO proposals, active votes, outcomes — Optimism, Arbitrum, Lido, Aave, ENS, and 14 others |
| `UPGRADE` | Client releases, testnet activations, hard fork timelines — all 10 Ethereum clients |
| `SECURITY` | Exploit post-mortems, audit publications, responsible disclosures, vulnerability advisories |
| `ANNOUNCEMENT` | Official communications from the Ethereum Foundation, L2 foundations, major protocols |
| `METRICS` | ETH supply, staking yield, L2 TVL, validator set composition, DEX volume via DefiLlama |

---

## Why 60 words

Sixty words is enough to answer three questions: **what happened**, **who was involved**, and **why it matters**. It is not enough to editorialize, speculate, or pad with context you already have.

Every card preserves the identifiers that matter to protocol developers: EIP numbers, vote percentages, client version strings, dollar amounts, author names. The original source is always one tap away.

---

## Source depth

**88 sources across 17 tiers — including sources no other aggregator tracks:**

| Tier | Sources |
|---|---|
| Core Protocol | ethresear.ch · Ethereum Magicians · EIPs repo · ERCs repo · ACD PM · Forkcast · EF Blog · Vitalik |
| Community Intelligence | Ethereum Cat Herders · Christine Kim ACDC Notes · Ethereum Weekly Digest |
| L2 Governance | Optimism · Arbitrum · zkSync · Starknet · Scroll · Polygon · Linea · Taiko · Uniswap |
| DeFi Governance | Aave · Lido · Compound · Curve · ENS · EigenLayer · The Graph · Safe · Sky (MakerDAO) |
| MEV / PBS | Flashbots Collective · Flashbots PM · MEV-Boost Relay |
| Client Releases | Geth · Nethermind · Besu · Reth · Erigon · Lighthouse · Prysm · Teku · Nimbus · Lodestar |
| Research Blogs | Paradigm · Flashbots Writings · Jon Charbonneau · samczsun · Nethermind Blog · Dankrad Feist · Polynya |
| Security | Rekt News · Trail of Bits · OpenZeppelin · Zellic · Chainalysis · SlowMist · Halborn · Dedaub · Consensys Diligence · Cyfrin · BlockSec |
| L2 Team Blogs | Optimism · Arbitrum · zkSync (Matter Labs) · StarkWare · Polygon Labs |
| Standards | RIPs · ERC-4337 / Account Abstraction · Foundry |
| Metrics | DefiLlama (TVL · stablecoins · DEX volume) |
| Protocol Coordination | Tim Beiko ACD Updates · Tim Beiko Substack |
| Ecosystem Media | Bankless · Devcon/Devconnect · Consensys |
| Crypto Signals | CryptoPanic (trending · hot · rising) · Crypto News API |
| Language Releases | Solidity · Vyper |

The complete source registry — every active source with its fetcher type, poll interval
and default category — lives in
[`packages/shared/src/constants/sources.ts`](./packages/shared/src/constants/sources.ts).

---

## How it works

### 1 · Fetch

11 fetcher types run on rolling schedules:

| Fetcher | Sources | Schedule |
|---|---|---|
| Discourse | ethresear.ch, Ethereum Magicians, 19 DAO governance forums | Every 2–4 hours |
| GitHub API | EIPs, ERCs, ACD PM — filters bot noise, only surfaces new proposals and meaningful merges | Every 4 hours |
| RSS | Client releases, L2 team blogs, research blogs, security auditors, EF Blog (48 feeds) | Every 30 min – 2 hours |
| REST API | DefiLlama (TVL, stablecoins, DEX volume) | Every 1 hour |
| CryptoPanic | Trending, hot, rising crypto signals | Every 30 minutes |
| Crypto News API | Filtered crypto news | Every 30 minutes |
| Custom scrapers | Rekt News, Paradigm, HackMD, Nethermind Blog, OpenZeppelin | Every 2–4 hours |

No manual curation step. EIP/ERC fetcher uses whitelist-based title filtering and bot author detection to exclude CI, config, and automated merge PRs.

### 2 · Quality Score

Every item receives a `0.0–1.0` quality score before the LLM sees it:

```
score = (source_weight × 0.40) + (content_signals × 0.60)
```

Content signals evaluate: headline quality (length, presence), summary quality, author attribution, and engagement metrics where available. Items scoring below `0.25` are suppressed automatically — they never reach the summarization step.

### 3 · Summarize

GPT-4.1 Mini (production) generates a factual 60-word summary. In development, Ollama with Llama 3.1 8B is used locally.

Word count is enforced with three boundaries:
- **Target**: 55–60 words (strict pass on first try)
- **Fallback**: 50–65 words (accepted after 3 retries)
- **Hard ceiling**: 67 words (anything above is truncated to 60)

Up to three retries per item with word count feedback. Critical technical identifiers — EIP numbers, vote percentages, client version strings, named authors — are checked for entity preservation before the card is written to the database.

A concurrent-safe rate limiter (promise chain) spaces API calls ≥150ms apart to stay within OpenAI Tier 1 limits (500 RPM).

### 4 · Personalized Feed

Authenticated users (via Clerk) receive unseen-first ordering. The feed tracks what you have read and always surfaces what you have not. Category filters apply globally. Source toggles let you hide any of the 88 sources from your view permanently.

---

## The feed experience

- **Vertical snap-scroll** — one card per screen, swipe to advance
- **8-category filter bar** — tap to narrow to a single signal type
- **Unseen-first ordering** — authenticated users always see fresh cards first
- **Bookmark to reading list** — accessible on any device, syncs across sessions
- **React to cards** — thumbs up/down used to tune feed quality over time
- **Flag inaccuracies** — three-step flow with reason selection; every flag is reviewed
- **Share natively** — X, Telegram, or copy link from any card
- **Onboarding tour** — first-time visitors get a guided spotlight tour of the interface
- **PWA** — installable on iOS and Android with context-aware install prompts (native prompt on Android, share-sheet instructions on iOS, QR/URL prompt on desktop)
- **Per-user rate limiting** — API routes enforce per-user limits (flags 10/hr, reactions 30/min, saves 30/min)

---

## Accuracy commitment

**Target: 97% factual accuracy on weekly random sample audits.**

- Word count enforced at write time (55–60 target, 67 hard max, up to 3 LLM retries)
- Entity preservation verified before card is committed to database
- EIP/ERC fetcher filters bot authors and CI/infrastructure PRs at ingestion
- All flagged cards reviewed within 24 hours
- Cards confirmed inaccurate are removed and reprocessed against original source

---

## Security

- **CSP headers** — Content-Security-Policy restricts script, style, connect, and frame sources to known domains (Clerk, PostHog, Supabase, Google Fonts)
- **HSTS** — `max-age=63072000; includeSubDomains; preload`
- **Input validation** — UUID format validation on all ID parameters, string length caps, array size limits, SQL wildcard escaping on search queries
- **Error sanitization** — API routes never expose raw database error messages to clients
- **Per-user rate limiting** — in-memory rate limiter keyed by `userId:action`
- **Duplicate flag prevention** — 409 on repeat flags for same card
- **Environment validation** — startup fails fast on missing required env vars
- **Global error boundary** — unhandled runtime errors render a recovery page, not a white screen
- **Production source maps disabled** — no source code exposure in production builds
- **Pipeline graceful shutdown** — SIGTERM/SIGINT release execution lock before exit
- **X-Frame-Options: DENY**, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (camera, microphone, geolocation, payment, USB, accelerometer, gyroscope)

---

## Suggest a source

Hexcast's quality depends on its source selection. If you know a source that belongs in the Hexcast Feed, open an issue with:

1. The source URL
2. Why it belongs (what category, what signal it provides)
3. Whether it has machine-readable access (RSS, public API, Discourse `/latest.json`, or structured HTML)

Sources are evaluated against four criteria: Ethereum-native content, machine-readable access, published within the last 90 days, and a reliability score of 3/5 or above.

Pull requests directly to [`packages/shared/src/constants/sources.ts`](./packages/shared/src/constants/sources.ts) are welcome. Each source entry requires `id`, `display_name`, `base_url`, `api_type`, `poll_interval_s`, and `default_category`.

---

## Keep Hexcast running

Hexcast is open source and free — no token, no paywall, no ads. Running it costs money: AI inference on every card, database hosting, 88 sources polled around the clock. If you find it useful, help keep the lights on.

```
0x15bF7E2CF2720422757eC58131a2270583Af778c
```

Ethereum or Base. ETH, USDC, USDT.

---

## License

MIT — see [LICENSE](./LICENSE)

---

<div align="center">

`[ hexcast ]` &nbsp;·&nbsp; ethereum ecosystem intelligence &nbsp;·&nbsp; February 2026

**[hexcast.xyz →](https://hexcast.xyz)**

</div>
