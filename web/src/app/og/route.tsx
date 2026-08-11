import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getCardById } from '@/lib/queries';

// The t3 palette: each category's card surface and its saturated badge hue,
// mirroring design-system.css so a shared card looks like the card it links to.
const CATEGORY_COLORS: Record<string, { surface: string; badge: string; badgeInk: string; body: string; meta: string }> = {
  RESEARCH: { surface: '#eef0f7', badge: '#4a5f96', badgeInk: '#eff1f8', body: '#242a3c', meta: '#5f6b8a' },
  EIP_ERC: { surface: '#e8eefb', badge: '#1f4fa8', badgeInk: '#eef3fd', body: '#25293a', meta: '#55617a' },
  PROTOCOL_CALLS: { surface: '#e6f2f4', badge: '#16646e', badgeInk: '#e8f6f8', body: '#1f2b2e', meta: '#4f6f75' },
  GOVERNANCE: { surface: '#f0edfa', badge: '#6149b2', badgeInk: '#f2eefd', body: '#272138', meta: '#5e5286' },
  UPGRADE: { surface: '#e8f3ec', badge: '#2c7a5c', badgeInk: '#eafaf1', body: '#1f2c26', meta: '#4e6f5f' },
  ANNOUNCEMENT: { surface: '#f0f0f1', badge: '#3f3f46', badgeInk: '#f4f4f5', body: '#26262b', meta: '#5c5c64' },
  METRICS: { surface: '#f8f1e4', badge: '#8a6516', badgeInk: '#fdf5e8', body: '#302713', meta: '#6f5a2e' },
  SECURITY: { surface: '#f7e9e7', badge: '#a3342c', badgeInk: '#fdeeec', body: '#33201e', meta: '#7d5450' },
}

const CATEGORY_LABELS: Record<string, string> = {
  RESEARCH: 'Research',
  EIP_ERC: 'EIP/ERC',
  PROTOCOL_CALLS: 'Protocol Calls',
  GOVERNANCE: 'Governance',
  UPGRADE: 'Upgrade',
  ANNOUNCEMENT: 'Announcement',
  METRICS: 'Metrics',
  SECURITY: 'Security',
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response('Missing id', { status: 400 });
    }

    // ── Card-specific OG image ──
    const card = await getCardById(id);
    if (!card) {
      return new Response('Card not found', { status: 404 });
    }

    const categoryLabel = CATEGORY_LABELS[card.category] ?? card.category;
    const colors = CATEGORY_COLORS[card.category] ?? CATEGORY_COLORS.RESEARCH;
    const summary = card.summary.length > 180 ? card.summary.slice(0, 180) + '...' : card.summary;

    let domain = '';
    try {
      domain = new URL(card.canonical_url).hostname.replace('www.', '');
    } catch {
      domain = '';
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: colors.surface,
            fontFamily: 'monospace',
            padding: '48px 56px',
          }}
        >
          {/* Top bar: category + source */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                padding: '6px 14px',
                fontSize: '14px',
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                color: colors.badgeInk,
                background: colors.badge,
                borderRadius: 13,
              }}
            >
              {categoryLabel}
            </div>
            <span
              style={{
                fontSize: '13px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase' as const,
                color: colors.meta,
              }}
            >
              {domain}
            </span>
          </div>

          {/* Divider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginTop: '36px',
            }}
          >
            <div style={{ height: '1px', flex: 1, background: 'rgba(16,16,20,0.14)' }} />
            <span
              style={{
                fontSize: '11px',
                letterSpacing: '0.15em',
                textTransform: 'uppercase' as const,
                color: colors.meta,
              }}
            >
              intel
            </span>
            <div style={{ height: '1px', flex: 1, background: 'rgba(16,16,20,0.14)' }} />
          </div>

          {/* Headline */}
          <div
            style={{
              marginTop: '28px',
              fontSize: '36px',
              fontWeight: 700,
              lineHeight: 1.25,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase' as const,
              color: '#101014',
            }}
          >
            {card.headline}
          </div>

          {/* Summary */}
          <div
            style={{
              marginTop: '20px',
              fontSize: '17px',
              lineHeight: 1.7,
              fontWeight: 400,
              color: colors.body,
            }}
          >
            {summary}
          </div>

          {/* Bottom: branding */}
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '24px',
              borderTop: '1px solid rgba(16,16,20,0.12)',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase' as const,
                color: '#101014',
              }}
            >
              
              Hexcast
              
            </div>
            <span
              style={{
                fontSize: '13px',
                letterSpacing: '0.08em',
                color: colors.meta,
              }}
            >
              Ethereum ecosystem intelligence
            </span>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch {
    return new Response('Failed to generate image', { status: 500 });
  }
}
