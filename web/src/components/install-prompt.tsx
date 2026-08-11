'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { capture } from '@/lib/posthog';

/* ── Types ──────────────────────────────────────────────────────── */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Variant = 'android' | 'ios' | 'desktop';

/* ── Helpers ────────────────────────────────────────────────────── */

function getDeviceType(): Variant {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

const COOLDOWNS: Record<Variant, number> = {
  android: 7 * 24 * 60 * 60 * 1000,   // 7 days
  ios: 14 * 24 * 60 * 60 * 1000,       // 14 days
  desktop: 30 * 24 * 60 * 60 * 1000,   // 30 days
};

const DELAYS: Record<Variant, number> = {
  android: 10_000, // 10s
  ios: 10_000,
  desktop: 20_000, // 20s
};

function dismissKey(v: Variant) {
  return `hexcast-dismiss-${v}`;
}

function isDismissed(v: Variant): boolean {
  const ts = localStorage.getItem(dismissKey(v));
  if (!ts) return false;
  return Date.now() - Number(ts) < COOLDOWNS[v];
}

/* ── Component ──────────────────────────────────────────────────── */

export function InstallPrompt() {
  const [variant, setVariant] = useState<Variant | null>(null);
  const [show, setShow] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone()) return;

    const device = getDeviceType();
    if (isDismissed(device)) return;

    if (device === 'android') {
      // Wait for beforeinstallprompt, then delay
      const handler = (e: Event) => {
        e.preventDefault();
        deferredPrompt.current = e as BeforeInstallPromptEvent;
        setTimeout(() => {
          setVariant('android');
          setShow(true);
          capture('install_prompt_shown', { variant: 'android' });
        }, DELAYS.android);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }

    // iOS and desktop don't need beforeinstallprompt
    const timer = setTimeout(() => {
      setVariant(device);
      setShow(true);
      capture('install_prompt_shown', { variant: device });
    }, DELAYS[device]);
    return () => clearTimeout(timer);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    capture('install_prompt_accepted', { variant: 'android', outcome });
    setShow(false);
    deferredPrompt.current = null;
  }, []);

  const handleDismiss = useCallback(() => {
    if (variant) {
      localStorage.setItem(dismissKey(variant), String(Date.now()));
      capture('install_prompt_dismissed', { variant });
    }
    setShow(false);
    deferredPrompt.current = null;
  }, [variant]);

  if (!show || !variant) return null;

  /* ── Android: compact bottom banner ──────────────────────────── */
  if (variant === 'android') {
    return (
      <div
        className="fixed z-50 left-4 right-4 animate-slide-up"
        style={{ bottom: 'calc(72px + max(0.5rem, env(safe-area-inset-bottom)))' }}
      >
        <div
          className="glass"
          style={{
            border: '1px solid var(--border-medium)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="text-[10px] font-semibold tracking-widest uppercase"
              style={{ color: 'var(--accent)', marginBottom: '3px' }}
            >
              install hexcast
            </div>
            <div
              className="text-[9px] tracking-wider leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              get notifications &amp; instant access from your home screen
            </div>
          </div>
          <button
            onClick={handleInstall}
            className="btn-cta shrink-0 px-3 py-1.5 text-[9px] font-medium tracking-widest uppercase"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
          >
            install
          </button>
          <button
            onClick={handleDismiss}
            className="btn-neon shrink-0 text-[11px]"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    );
  }

  /* ── iOS: instruction sheet ──────────────────────────────────── */
  if (variant === 'ios') {
    const isSafari = isIOSSafari();
    return (
      <div
        className="fixed z-50 left-4 right-4 animate-slide-up"
        style={{ bottom: 'calc(72px + max(0.5rem, env(safe-area-inset-bottom)))' }}
      >
        <div
          className="glass"
          style={{
            border: '1px solid var(--border-medium)',
            padding: '16px',
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div>
              <div
                className="text-[10px] font-semibold tracking-widest uppercase"
                style={{ color: 'var(--accent)', marginBottom: '3px' }}
              >
                add to home screen
              </div>
              <div
                className="text-[9px] tracking-wider leading-relaxed"
                style={{ color: 'var(--text-muted)' }}
              >
                {isSafari
                  ? 'install hexcast for the full app experience'
                  : 'open hexcast.xyz in safari to install'}
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="btn-neon shrink-0 text-[11px] -mt-1"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>

          {/* Divider */}
          <div className="h-px mb-3" style={{ background: 'var(--border-subtle)' }} />

          {/* Steps */}
          <div className="flex flex-col gap-3">
            {!isSafari && (
              <div className="flex items-center gap-3">
                <div
                  className="shrink-0 w-8 h-8 flex items-center justify-center"
                  style={{
                    border: '1px solid var(--border-medium)',
                    background: 'var(--bg-surface)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <div>
                  <div className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-primary)' }}>
                    open in safari first
                  </div>
                  <div className="text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    chrome on ios cannot install apps
                  </div>
                </div>
              </div>
            )}

            {/* Step 1 */}
            <div className="flex items-center gap-3">
              <div
                className="shrink-0 w-8 h-8 flex items-center justify-center"
                style={{
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-surface)',
                }}
              >
                {/* Share icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-primary)' }}>
                  tap the share button
                </div>
                <div className="text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  at the bottom of safari
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-center gap-3">
              <div
                className="shrink-0 w-8 h-8 flex items-center justify-center"
                style={{
                  border: '1px solid var(--border-medium)',
                  background: 'var(--bg-surface)',
                }}
              >
                {/* Plus in square icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <div>
                <div className="text-[10px] font-medium tracking-wider uppercase" style={{ color: 'var(--text-primary)' }}>
                  &ldquo;add to home screen&rdquo;
                </div>
                <div className="text-[9px] tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  scroll down in the share menu
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Desktop: bottom-right card ──────────────────────────────── */
  /* Styled to the imported design: a light panel on the card radius, mono reserved
     for the label and the host, Geist for the sentence. The old version was the
     previous neon-terminal palette and read as a different product. */
  return (
    <div className="hx-install" role="dialog" aria-label="Open Hexcast on mobile">
      <div className="hx-install-head">
        <span className="hx-install-label">Hexcast on mobile</span>
        <button onClick={handleDismiss} className="hx-install-close" aria-label="Dismiss">
          &times;
        </button>
      </div>

      <p className="hx-install-body">
        Open hexcast on your phone to read the feed on the go, offline, with alerts
        when something breaks.
      </p>

      <div className="hx-install-host">
        {typeof window !== 'undefined' ? window.location.host : 'hexcast.xyz'}
      </div>

      <p className="hx-install-note">Works in any browser · add to home screen for offline cards</p>
    </div>
  );
}
