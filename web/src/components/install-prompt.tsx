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
      <div className="hx-install hx-install-mobile" role="dialog" aria-label="Install Hexcast">
        <div className="hx-install-head">
          <span className="hx-install-label">Install Hexcast</span>
          <button onClick={handleDismiss} className="hx-install-close" aria-label="Dismiss">
            &times;
          </button>
        </div>
        <p className="hx-install-body">
          Cards on your home screen, readable offline, with alerts when something breaks.
        </p>
        <button onClick={handleInstall} className="hx-btn-ink" style={{ width: '100%', justifyContent: 'center' }}>
          Add to home screen
        </button>
      </div>
    );
  }

  /* ── iOS: instruction sheet ──────────────────────────────────── */
  if (variant === 'ios') {
    const isSafari = isIOSSafari();
    return (
      <div className="hx-install hx-install-mobile" role="dialog" aria-label="Install Hexcast">
        <div className="hx-install-head">
          <span className="hx-install-label">Add to home screen</span>
          <button onClick={handleDismiss} className="hx-install-close" aria-label="Dismiss">
            &times;
          </button>
        </div>

        <div className="hx-install-steps">
          {!isSafari && (
            <div className="hx-install-step">
              <span className="hx-install-num">1</span>
              <div>
                <div>Open in Safari first</div>
                <p>Chrome on iOS cannot install apps.</p>
              </div>
            </div>
          )}
          <div className="hx-install-step">
            <span className="hx-install-num">{isSafari ? '1' : '2'}</span>
            <div>
              <div>Tap the share button</div>
              <p>At the bottom of Safari.</p>
            </div>
          </div>
          <div className="hx-install-step">
            <span className="hx-install-num">{isSafari ? '2' : '3'}</span>
            <div>
              <div>&ldquo;Add to Home Screen&rdquo;</div>
              <p>Scroll down in the share menu.</p>
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
