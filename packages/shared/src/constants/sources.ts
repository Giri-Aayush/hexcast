import type { Category } from './categories';

export interface SourceDefinition {
  id: string;
  display_name: string;
  base_url: string;
  api_type: 'discourse' | 'github_api' | 'rss' | 'graphql' | 'html_scraper' | 'nethermind_scraper' | 'rest_api' | 'cryptopanic' | 'crypto_news_api' | 'rekt_scraper' | 'paradigm_scraper' | 'hackmd_scraper';
  poll_interval_s: number;
  default_category: Category;
}

// ── Tier 1: Core Protocol Sources ──────────────────────────────────────

export const TIER_1_SOURCES: SourceDefinition[] = [
  {
    id: 'ethresear.ch',
    display_name: 'Ethereum Research',
    base_url: 'https://ethresear.ch',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'ethereum-magicians.org',
    display_name: 'Fellowship of Ethereum Magicians',
    base_url: 'https://ethereum-magicians.org',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'EIP_ERC',
  },
  {
    id: 'github.com/ethereum/EIPs',
    display_name: 'Ethereum Improvement Proposals',
    base_url: 'https://github.com/ethereum/EIPs',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'EIP_ERC',
  },
  {
    id: 'github.com/ethereum/ERCs',
    display_name: 'Ethereum Request for Comments',
    base_url: 'https://github.com/ethereum/ERCs',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'EIP_ERC',
  },
  {
    id: 'github.com/ethereum/pm',
    display_name: 'All Core Devs Project Management',
    base_url: 'https://github.com/ethereum/pm',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'PROTOCOL_CALLS',
  },
  {
    id: 'forkcast.org',
    display_name: 'Forkcast - ACD Call Archive',
    base_url: 'https://forkcast.org',
    api_type: 'html_scraper',
    poll_interval_s: 7200,
    default_category: 'PROTOCOL_CALLS',
  },
  {
    id: 'blog.ethereum.org',
    display_name: 'Ethereum Foundation Blog',
    base_url: 'https://blog.ethereum.org',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'vitalik.eth.limo',
    display_name: "Vitalik Buterin's Blog",
    base_url: 'https://vitalik.eth.limo',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
];

// ── Tier 2: Community Intelligence Sources (RSS) ───────────────────────

export const TIER_2_SOURCES: SourceDefinition[] = [
  {
    id: 'medium.com/ethereum-cat-herders',
    display_name: 'Ethereum Cat Herders',
    base_url: 'https://medium.com/ethereum-cat-herders',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'PROTOCOL_CALLS',
  },
  {
    id: 'christinedkim.substack.com',
    display_name: 'Christine Kim — ACDC Notes',
    base_url: 'https://christinedkim.substack.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'PROTOCOL_CALLS',
  },
  {
    id: 'ethereumweeklydigest.substack.com',
    display_name: 'Ethereum Weekly Digest',
    base_url: 'https://ethereumweeklydigest.substack.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
];

// ── Tier 3: Layer 2 Governance Sources (Discourse) ─────────────────────

export const TIER_3_SOURCES: SourceDefinition[] = [
  {
    id: 'gov.optimism.io',
    display_name: 'Optimism Collective Governance',
    base_url: 'https://gov.optimism.io',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.arbitrum.foundation',
    display_name: 'Arbitrum DAO Forum',
    base_url: 'https://forum.arbitrum.foundation',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.zknation.io',
    display_name: 'ZK Nation (zkSync) Forum',
    base_url: 'https://forum.zknation.io',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'community.starknet.io',
    display_name: 'Starknet Community Forum',
    base_url: 'https://community.starknet.io',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'gov.uniswap.org',
    display_name: 'Uniswap Governance Forum',
    base_url: 'https://gov.uniswap.org',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
];

// ── Tier 5: Ethereum Client Release Feeds (Atom/RSS) ───────────────────

export const TIER_5_SOURCES: SourceDefinition[] = [
  {
    id: 'github.com/ethereum/go-ethereum',
    display_name: 'Geth (Execution Layer)',
    base_url: 'https://github.com/ethereum/go-ethereum',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/NethermindEth/nethermind',
    display_name: 'Nethermind (Execution Layer)',
    base_url: 'https://github.com/NethermindEth/nethermind',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/hyperledger/besu',
    display_name: 'Besu (Execution Layer)',
    base_url: 'https://github.com/hyperledger/besu',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/paradigmxyz/reth',
    display_name: 'Reth (Execution Layer)',
    base_url: 'https://github.com/paradigmxyz/reth',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/erigontech/erigon',
    display_name: 'Erigon (Execution Layer)',
    base_url: 'https://github.com/erigontech/erigon',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/sigp/lighthouse',
    display_name: 'Lighthouse (Consensus Layer)',
    base_url: 'https://github.com/sigp/lighthouse',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/OffchainLabs/prysm',
    display_name: 'Prysm (Consensus Layer)',
    base_url: 'https://github.com/OffchainLabs/prysm',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/ConsenSys/teku',
    display_name: 'Teku (Consensus Layer)',
    base_url: 'https://github.com/ConsenSys/teku',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/status-im/nimbus-eth2',
    display_name: 'Nimbus (Consensus Layer)',
    base_url: 'https://github.com/status-im/nimbus-eth2',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/ChainSafe/lodestar',
    display_name: 'Lodestar (Consensus Layer)',
    base_url: 'https://github.com/ChainSafe/lodestar',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
];

// ── Tier 6: On-Chain Metrics (DefiLlama REST API) ───────────────────

export const TIER_6_SOURCES: SourceDefinition[] = [
  {
    id: 'defillama.com/stablecoins',
    display_name: 'DefiLlama — Stablecoin Metrics',
    base_url: 'https://api.llama.fi',
    api_type: 'rest_api',
    poll_interval_s: 3600,
    default_category: 'METRICS',
  },
  {
    id: 'defillama.com/chains',
    display_name: 'DefiLlama — Chain TVL Tracker',
    base_url: 'https://api.llama.fi',
    api_type: 'rest_api',
    poll_interval_s: 3600,
    default_category: 'METRICS',
  },
  {
    id: 'defillama.com/dexs',
    display_name: 'DefiLlama — DEX Volume Tracker',
    base_url: 'https://api.llama.fi',
    api_type: 'rest_api',
    poll_interval_s: 3600,
    default_category: 'METRICS',
  },
];

// ── Tier 7: Crypto Social / Trending Sources ────────────────────────────

export const TIER_7_SOURCES: SourceDefinition[] = [
  {
    id: 'cryptopanic.com/trending',
    display_name: 'CryptoPanic — Trending',
    base_url: 'https://cryptopanic.com/api/developer/v2/posts/',
    api_type: 'cryptopanic',
    poll_interval_s: 1800,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'cryptopanic.com/hot',
    display_name: 'CryptoPanic — Hot',
    base_url: 'https://cryptopanic.com/api/developer/v2/posts/',
    api_type: 'cryptopanic',
    poll_interval_s: 1800,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'cryptopanic.com/rising',
    display_name: 'CryptoPanic — Rising',
    base_url: 'https://cryptopanic.com/api/developer/v2/posts/',
    api_type: 'cryptopanic',
    poll_interval_s: 1800,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'cryptocurrency.cv/news',
    display_name: 'Crypto News — Latest',
    base_url: 'https://cryptocurrency.cv/api/news',
    api_type: 'crypto_news_api',
    poll_interval_s: 3600,
    default_category: 'ANNOUNCEMENT',
  },
];

// ── Tier 8: DeFi Protocol Governance (Discourse) ────────────────────────

export const TIER_8_DEFI_GOVERNANCE: SourceDefinition[] = [
  {
    id: 'research.lido.fi',
    display_name: 'Lido Research Forum',
    base_url: 'https://research.lido.fi',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'comp.xyz',
    display_name: 'Compound Community Forum',
    base_url: 'https://www.comp.xyz',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'gov.curve.finance',
    display_name: 'Curve Governance Forum',
    base_url: 'https://gov.curve.finance',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'discuss.ens.domains',
    display_name: 'ENS DAO Forum',
    base_url: 'https://discuss.ens.domains',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.eigenlayer.xyz',
    display_name: 'EigenLayer Forum',
    base_url: 'https://forum.eigenlayer.xyz',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.thegraph.com',
    display_name: 'The Graph Forum',
    base_url: 'https://forum.thegraph.com',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.safe.global',
    display_name: 'Safe Forum',
    base_url: 'https://forum.safe.global',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'governance.aave.com',
    display_name: 'Aave Governance Forum',
    base_url: 'https://governance.aave.com',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.sky.money',
    display_name: 'Sky (MakerDAO) Forum',
    base_url: 'https://forum.sky.money',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
];

// ── Tier 9: Additional L2 Governance (Discourse) ────────────────────────

export const TIER_9_L2_GOVERNANCE: SourceDefinition[] = [
  {
    id: 'forum.scroll.io',
    display_name: 'Scroll Governance Forum',
    base_url: 'https://forum.scroll.io',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'forum.polygon.technology',
    display_name: 'Polygon Community Forum',
    base_url: 'https://forum.polygon.technology',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'community.linea.build',
    display_name: 'Linea Community Forum',
    base_url: 'https://community.linea.build',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
  {
    id: 'community.taiko.xyz',
    display_name: 'Taiko Community Forum',
    base_url: 'https://community.taiko.xyz',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'GOVERNANCE',
  },
];

// ── Tier 10: MEV / PBS (Discourse + GitHub) ──────────────────────────────

export const TIER_10_MEV: SourceDefinition[] = [
  {
    id: 'collective.flashbots.net',
    display_name: 'Flashbots Collective Forum',
    base_url: 'https://collective.flashbots.net',
    api_type: 'discourse',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'github.com/flashbots/pm',
    display_name: 'Flashbots Project Management',
    base_url: 'https://github.com/flashbots/pm',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'RESEARCH',
  },
  {
    id: 'github.com/flashbots/mev-boost-relay',
    display_name: 'Flashbots MEV-Boost Relay',
    base_url: 'https://github.com/flashbots/mev-boost-relay',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'UPGRADE',
  },
];

// ── Tier 11: Standards & Developer Tooling (GitHub) ──────────────────────

export const TIER_11_STANDARDS: SourceDefinition[] = [
  {
    id: 'github.com/ethereum/RIPs',
    display_name: 'Rollup Improvement Proposals',
    base_url: 'https://github.com/ethereum/RIPs',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'EIP_ERC',
  },
  {
    id: 'github.com/eth-infinitism/account-abstraction',
    display_name: 'ERC-4337 Account Abstraction',
    base_url: 'https://github.com/eth-infinitism/account-abstraction',
    api_type: 'github_api',
    poll_interval_s: 14400,
    default_category: 'EIP_ERC',
  },
  {
    id: 'github.com/foundry-rs/foundry',
    display_name: 'Foundry (Forge/Cast/Anvil)',
    base_url: 'https://github.com/foundry-rs/foundry',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
];

// ── Tier 12: Research & Security Blogs (RSS) ─────────────────────────────

export const TIER_12_RESEARCH_RSS: SourceDefinition[] = [
  {
    id: 'joncharbonneau.substack.com',
    display_name: 'Jon Charbonneau — Protocol Research',
    base_url: 'https://joncharbonneau.substack.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'blog.trailofbits.com',
    display_name: 'Trail of Bits Blog',
    base_url: 'https://blog.trailofbits.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'www.openzeppelin.com',
    display_name: 'OpenZeppelin — Security & Research',
    base_url: 'https://www.openzeppelin.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'www.nethermind.io',
    display_name: 'Nethermind Blog',
    base_url: 'https://www.nethermind.io',
    api_type: 'nethermind_scraper',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
];

// ── Tier 13: Research, Security & Protocol Blogs II (RSS) ─────────────────

export const TIER_13_BLOGS: SourceDefinition[] = [
  {
    id: 'blog.sigmaprime.io',
    display_name: 'Sigma Prime Blog',
    base_url: 'https://blog.sigmaprime.io',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'blog.lido.fi',
    display_name: 'Lido Finance Blog',
    base_url: 'https://blog.lido.fi',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'blog.chain.link',
    display_name: 'Chainlink Blog',
    base_url: 'https://blog.chain.link',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'medium.com/immunefi',
    display_name: 'Immunefi — Bug Bounty Reports',
    base_url: 'https://medium.com/immunefi',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'offchain.medium.com',
    display_name: 'Offchain Labs (Arbitrum)',
    base_url: 'https://offchain.medium.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'www.theblock.co',
    display_name: 'The Block — Crypto News',
    base_url: 'https://www.theblock.co',
    api_type: 'rss',
    poll_interval_s: 3600,
    default_category: 'ANNOUNCEMENT',
  },
];

// ── Tier 14: Smart Contract Language Releases (Atom/RSS) ──────────────────

export const TIER_14_LANGUAGE_RELEASES: SourceDefinition[] = [
  {
    id: 'github.com/ethereum/solidity',
    display_name: 'Solidity Compiler Releases',
    base_url: 'https://github.com/ethereum/solidity',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
  {
    id: 'github.com/vyperlang/vyper',
    display_name: 'Vyper Compiler Releases',
    base_url: 'https://github.com/vyperlang/vyper',
    api_type: 'rss',
    poll_interval_s: 1800,
    default_category: 'UPGRADE',
  },
];

// ── Tier 15: L2 Team Blogs (RSS) ──────────────────────────────────────────

export const TIER_15_L2_BLOGS: SourceDefinition[] = [
  {
    id: 'medium.com/ethereum-optimism',
    display_name: 'Optimism Blog',
    base_url: 'https://medium.com/ethereum-optimism',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'blog.arbitrum.io',
    display_name: 'Arbitrum Blog',
    base_url: 'https://blog.arbitrum.io',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'blog.matter-labs.io',
    display_name: 'zkSync (Matter Labs) Blog',
    base_url: 'https://blog.matter-labs.io',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'starkware.co',
    display_name: 'StarkWare Blog',
    base_url: 'https://starkware.co',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'medium.com/@polygonlabs',
    display_name: 'Polygon Labs Blog',
    base_url: 'https://medium.com/@polygonlabs',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
];

// ── Tier 16: Research & Developer Blogs (RSS) ─────────────────────────────

export const TIER_16_RESEARCH_BLOGS: SourceDefinition[] = [
  {
    id: 'dankradfeist.de',
    display_name: 'Dankrad Feist — Ethereum Research',
    base_url: 'https://dankradfeist.de',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'medium.com/@polynya',
    display_name: 'Polynya — L2 & Scaling Research',
    base_url: 'https://medium.com/@polynya',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'timbeiko.substack.com',
    display_name: 'Tim Beiko — Protocol Updates',
    base_url: 'https://timbeiko.substack.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'PROTOCOL_CALLS',
  },
  {
    id: 'bankless.com',
    display_name: 'Bankless — News & Analysis',
    base_url: 'https://www.bankless.com',
    api_type: 'rss',
    poll_interval_s: 3600,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'paragraph.xyz/@devcon',
    display_name: 'Devcon / Devconnect Updates',
    base_url: 'https://paragraph.xyz/@devcon',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
  {
    id: 'medium.com/consensys-media',
    display_name: 'Consensys Blog',
    base_url: 'https://medium.com/consensys-media',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'ANNOUNCEMENT',
  },
];

// ── Tier 17: Security Auditors & Researchers (RSS) ────────────────────────

export const TIER_17_SECURITY: SourceDefinition[] = [
  {
    id: 'www.zellic.io',
    display_name: 'Zellic — Security Research',
    base_url: 'https://www.zellic.io',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'www.chainalysis.com',
    display_name: 'Chainalysis Blog',
    base_url: 'https://www.chainalysis.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'slowmist.medium.com',
    display_name: 'SlowMist — Security Intelligence',
    base_url: 'https://slowmist.medium.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'www.halborn.com',
    display_name: 'Halborn — Blockchain Security',
    base_url: 'https://www.halborn.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'medium.com/dedaub',
    display_name: 'Dedaub — Smart Contract Security',
    base_url: 'https://medium.com/dedaub',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'medium.com/consensys-diligence',
    display_name: 'Consensys Diligence — Audits',
    base_url: 'https://medium.com/consensys-diligence',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'medium.com/cyfrin',
    display_name: 'Cyfrin — Security Blog',
    base_url: 'https://medium.com/cyfrin',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'medium.com/@BlockSec',
    display_name: 'BlockSec — Security Research',
    base_url: 'https://medium.com/@BlockSec',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
];

// ── All Sources ────────────────────────────────────────────────────────

// ── P1: High-Signal Sources (custom scrapers + RSS) ──────────────────────

export const P1_HIGH_SIGNAL: SourceDefinition[] = [
  {
    id: 'rekt.news',
    display_name: 'Rekt News — Exploit Post-Mortems',
    base_url: 'https://rekt.news',
    api_type: 'rekt_scraper',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'paradigm.xyz',
    display_name: 'Paradigm Research',
    base_url: 'https://www.paradigm.xyz',
    api_type: 'paradigm_scraper',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'writings.flashbots.net',
    display_name: 'Flashbots Writings',
    base_url: 'https://writings.flashbots.net',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'RESEARCH',
  },
  {
    id: 'samczsun.com',
    display_name: 'samczsun — Security Research',
    base_url: 'https://samczsun.com',
    api_type: 'rss',
    poll_interval_s: 7200,
    default_category: 'SECURITY',
  },
  {
    id: 'hackmd.io/@timbeiko/acd',
    display_name: 'Tim Beiko — ACD Updates',
    base_url: 'https://hackmd.io/@timbeiko/acd',
    api_type: 'hackmd_scraper',
    poll_interval_s: 14400,
    default_category: 'PROTOCOL_CALLS',
  },
];

// ── All Sources ────────────────────────────────────────────────────────

export const ALL_SOURCES: SourceDefinition[] = [
  ...TIER_1_SOURCES,
  ...TIER_2_SOURCES,
  ...TIER_3_SOURCES,
  ...TIER_5_SOURCES,
  ...TIER_6_SOURCES,
  ...TIER_7_SOURCES,
  ...TIER_8_DEFI_GOVERNANCE,
  ...TIER_9_L2_GOVERNANCE,
  ...TIER_10_MEV,
  ...TIER_11_STANDARDS,
  ...TIER_12_RESEARCH_RSS,
  ...TIER_13_BLOGS,
  ...TIER_14_LANGUAGE_RELEASES,
  ...TIER_15_L2_BLOGS,
  ...TIER_16_RESEARCH_BLOGS,
  ...TIER_17_SECURITY,
  ...P1_HIGH_SIGNAL,
];

// ── Source Quality Rankings ─────────────────────────────────────────────
// S = core protocol + top researchers, A = clients/standards/security,
// B = governance/blogs, C = aggregators/social

export type QualityGrade = 'S' | 'A' | 'B' | 'C';

const GRADE_MAP: [QualityGrade, SourceDefinition[]][] = [
  ['S', [...TIER_1_SOURCES, ...P1_HIGH_SIGNAL]],
  ['A', [...TIER_2_SOURCES, ...TIER_5_SOURCES, ...TIER_10_MEV, ...TIER_11_STANDARDS, ...TIER_12_RESEARCH_RSS, ...TIER_14_LANGUAGE_RELEASES, ...TIER_16_RESEARCH_BLOGS]],
  ['B', [...TIER_3_SOURCES, ...TIER_6_SOURCES, ...TIER_8_DEFI_GOVERNANCE, ...TIER_13_BLOGS, ...TIER_15_L2_BLOGS, ...TIER_17_SECURITY]],
  ['C', [...TIER_7_SOURCES, ...TIER_9_L2_GOVERNANCE]],
];

export const SOURCE_QUALITY: Record<string, QualityGrade> = {};
for (const [grade, sources] of GRADE_MAP) {
  for (const src of sources) {
    SOURCE_QUALITY[src.id] = grade;
  }
}

export const GRADE_SORT_ORDER: Record<QualityGrade, number> = { S: 0, A: 1, B: 2, C: 3 };

/**
 * Sources that stay in the registry but must not be polled, with the reason.
 *
 * This lives here rather than only in migration 020 because migrations run BEFORE
 * the seed on a fresh database. 020's UPDATEs hit an empty source_registry, do
 * nothing, and then the seed inserts all 88 rows with is_active defaulting to
 * true — so a freshly provisioned database silently comes up polling four dead
 * endpoints. That cost a manual re-run of 020 during the 2026-08-12 provision.
 *
 * Declaring it in the seed data makes registry state reproducible regardless of
 * provisioning order. The consequence, deliberately: the seed is now the authority
 * on is_active, so deactivating a source by hand in the database will be reverted
 * by the next seed. Deactivations belong here.
 */
export const DEACTIVATED_SOURCES: Record<string, string> = {
  'ethereumweeklydigest.substack.com': 'Feed request times out after 60s (checked 2026-08-11)',
  'blog.chain.link': 'RSS endpoint no longer resolves (checked 2026-08-11)',
  'samczsun.com': 'RSS endpoint no longer resolves (checked 2026-08-11)',
  'gov.curve.finance': 'Discourse /latest.json returns zero topics (checked 2026-08-11)',
};
