export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export const CATEGORY_LABELS: Record<string, string> = {
  RESEARCH: 'Research',
  EIP_ERC: 'EIP/ERC',
  PROTOCOL_CALLS: 'Protocol Calls',
  GOVERNANCE: 'Governance',
  UPGRADE: 'Upgrade',
  ANNOUNCEMENT: 'Announcement',
  METRICS: 'Metrics',
  SECURITY: 'Security',
};

export const CATEGORY_BADGE_CLASS: Record<string, string> = {
  RESEARCH: 'badge-research',
  EIP_ERC: 'badge-eip',
  PROTOCOL_CALLS: 'badge-protocol',
  GOVERNANCE: 'badge-governance',
  UPGRADE: 'badge-upgrade',
  ANNOUNCEMENT: 'badge-announcement',
  METRICS: 'badge-metrics',
  SECURITY: 'badge-security',
};

// Keep old export name for backward compat
export const CATEGORY_COLORS = CATEGORY_BADGE_CLASS;

/**
 * Split a summary into plain runs and "figures" — the identifiers and quantities the
 * design sets in mono inside running text, so `EIP-7702` and `v1.16.4` read as tokens
 * rather than words.
 *
 * Matches, in order of the alternation:
 *   - spec identifiers: EIP-7702, ERC-4337, RIP-7212
 *   - versions: v1.16.4, and bare dotted releases like 1.34.1
 *   - quantities: $15B, 1,214,300, 71%, 12/18, 30%
 *
 * Deliberately does NOT match a lone small integer. "four to six subnets" and "two
 * weeks" are prose, and setting them in mono would speckle the paragraph — the point
 * is to mark the things a reader scans for, not every digit.
 */
/* Boundaries are per-alternative, not wrapped around the group. A trailing \b after
   `%` never matches (both sides non-word), and a leading \b before `$` never matches
   either — so the obvious `\b(?:…)\b` silently drops "71%" and "$15B". */
const FIGURE_RE = new RegExp(
  [
    '\\b(?:EIP|ERC|RIP|BIP)-\\d+', // EIP-7702
    '\\bv\\d+(?:\\.\\d+)+', // v1.16.4
    '\\b\\d+(?:\\.\\d+){2,}', // 1.34.1 — two dots minimum, so "1.6" stays prose
    '\\$\\d+(?:[.,]\\d+)*[KMBT]?', // $15B
    '\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?', // 1,214,300
    '\\b\\d+(?:\\.\\d+)?%', // 71%
    '\\b\\d+/\\d+', // 12/18
  ].join('|'),
  'g',
);

export interface SummarySegment {
  text: string;
  figure: boolean;
}

export function splitFigures(summary: string): SummarySegment[] {
  const segments: SummarySegment[] = [];
  let last = 0;

  // exec loop rather than matchAll so the lastIndex reset below is explicit — the
  // regex is module-level and /g, so it carries state between calls otherwise.
  FIGURE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIGURE_RE.exec(summary)) !== null) {
    if (match.index > last) {
      segments.push({ text: summary.slice(last, match.index), figure: false });
    }
    segments.push({ text: match[0], figure: true });
    last = match.index + match[0].length;
  }

  if (last < summary.length) {
    segments.push({ text: summary.slice(last), figure: false });
  }

  return segments;
}
