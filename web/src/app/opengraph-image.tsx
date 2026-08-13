import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Hexcast · Ethereum ecosystem intelligence';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06060a',
          fontFamily: 'monospace',
        }}
      >
        {/* Top rule */}
        <div
          style={{
            position: 'absolute',
            top: 80,
            left: 120,
            right: 120,
            height: 1,
            background: '#1a1a2e',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 76,
            left: 120,
            width: 16,
            height: 9,
            background: '#3b82f6',
            opacity: 0.7,
            display: 'flex',
          }}
        />

        {/* Main content */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -2,
          }}
        >
          <span style={{ color: '#3b82f6' }}>[</span>
          <span style={{ color: '#e8e8f0' }}>hexcast</span>
          <span style={{ color: '#3b82f6' }}>]</span>
        </div>

        {/* Tagline */}
        <div
          style={{
            marginTop: 24,
            fontSize: 22,
            fontWeight: 400,
            letterSpacing: 6,
            textTransform: 'uppercase',
            color: '#8a8a9a',
            display: 'flex',
          }}
        >
          ethereum ecosystem intelligence
        </div>

        {/* Stats row */}
        <div
          style={{
            marginTop: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 32,
            fontSize: 16,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#5a5a6e',
          }}
        >
          <span style={{ display: 'flex' }}>
            <span style={{ color: '#3b82f6', marginRight: 8 }}>88</span> sources
          </span>
          <span style={{ color: '#2a2a3e', display: 'flex' }}>//</span>
          <span style={{ display: 'flex' }}>
            <span style={{ color: '#3b82f6', marginRight: 8 }}>8</span> categories
          </span>
          <span style={{ color: '#2a2a3e', display: 'flex' }}>//</span>
          <span style={{ display: 'flex' }}>
            <span style={{ color: '#3b82f6', marginRight: 8 }}>60</span> word cards
          </span>
        </div>

        {/* Bottom rule */}
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 120,
            right: 120,
            height: 1,
            background: '#1a1a2e',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 76,
            right: 120,
            width: 16,
            height: 9,
            background: '#3b82f6',
            opacity: 0.7,
            display: 'flex',
          }}
        />

        {/* URL */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            fontSize: 14,
            letterSpacing: 3,
            color: '#3a3a4e',
            display: 'flex',
          }}
        >
          hexcast.xyz
        </div>
      </div>
    ),
    { ...size },
  );
}
