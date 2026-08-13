'use client';

import { memo, useEffect, useState, useRef } from 'react';
import { useUser, useAuthActions } from '@/lib/auth-ui';
import type { Card as CardType } from '@hexcast/shared';
import {
  relativeTime,
  extractDomain,
  CATEGORY_LABELS,
  splitFigures,
} from '@/lib/utils';
import { useSaved } from '@/stores/saved';
import { useReactions } from '@/stores/reactions';
import { toast } from './toast';
import { capture } from '@/lib/posthog';

interface CardProps {
  card: CardType & { seen?: boolean };
  /** 1-based place in the feed, rendered opposite the badge as "04/27". */
  position?: { index: number; total: number };
}

const FLAG_REASONS = [
  'Inaccurate information',
  'Spam or irrelevant',
  'Duplicate content',
  'Other',
] as const;

/** Two digits, so 4 of 27 reads as 04/27 and the column does not jitter. */
const pad = (n: number) => String(n).padStart(2, '0');

export const Card = memo(function Card({ card, position }: CardProps) {
  const [flagged, setFlagged] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [flagStep, setFlagStep] = useState<'idle' | 'reason' | 'confirm' | 'done'>('idle');
  const [flagReason, setFlagReason] = useState('');
  const [flagCustom, setFlagCustom] = useState('');
  // A stored image URL that 404s (deleted from the bucket, say) falls back to the
  // dither rather than showing a broken frame — the band stays intact either way.
  const [imgFailed, setImgFailed] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  const { isSignedIn } = useUser();
  const { openSignIn } = useAuthActions();
  const { isSaved, toggleSave, initialized } = useSaved();
  const { getUserReaction, getCounts, react } = useReactions();
  const saved = initialized && isSaved(card.id);
  const userReaction = getUserReaction(card.id);
  const counts = getCounts(card.id);
  const categoryLabel = CATEGORY_LABELS[card.category] ?? card.category;

  // Auto-dismiss thank you after 3s
  useEffect(() => {
    if (flagStep !== 'done') return;
    const t = setTimeout(() => setFlagStep('idle'), 3000);
    return () => clearTimeout(t);
  }, [flagStep]);

  // Close the share popover on an outside tap.
  useEffect(() => {
    if (!shareOpen) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShareOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [shareOpen]);

  // ── Share handlers ──

  const cardUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/card/${card.id}`
      : `/card/${card.id}`;

  function shareOnX(e: React.MouseEvent) {
    e.stopPropagation();
    const text = `${card.headline}\n\n[${categoryLabel}] via Hexcast`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(cardUrl)}`;
    window.open(url, '_blank', 'noopener');
    capture('card_shared', { card_id: card.id, platform: 'x' });
    setShareOpen(false);
  }

  function shareOnTelegram(e: React.MouseEvent) {
    e.stopPropagation();
    const url = `https://t.me/share/url?url=${encodeURIComponent(cardUrl)}&text=${encodeURIComponent(card.headline)}`;
    window.open(url, '_blank', 'noopener');
    capture('card_shared', { card_id: card.id, platform: 'telegram' });
    setShareOpen(false);
  }

  async function copyLink(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(`${card.headline}\n${cardUrl}`);
    toast('Copied to clipboard');
    capture('card_shared', { card_id: card.id, platform: 'copy' });
    setShareOpen(false);
  }

  // ── Flag handlers ──

  function handleFlagClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (flagged) return;
    if (isSignedIn === false) {
      openSignIn();
      return;
    }
    if (!isSignedIn) return;
    setFlagStep('reason');
    setFlagReason('');
    setFlagCustom('');
  }

  function selectReason(reason: string) {
    setFlagReason(reason);
    if (reason !== 'Other') setFlagStep('confirm');
  }

  function confirmOtherReason() {
    if (flagCustom.trim()) {
      setFlagReason(flagCustom.trim());
      setFlagStep('confirm');
    }
  }

  async function submitFlag() {
    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: card.id, reason: flagReason }),
      });
      if (!res.ok) throw new Error('Failed');
      setFlagged(true);
      setFlagStep('done');
      capture('card_flagged', { card_id: card.id, reason: flagReason });
    } catch {
      toast('Failed to flag. Try again.');
      setFlagStep('idle');
    }
  }

  // ── Reaction handler ──

  async function handleReaction(e: React.MouseEvent, type: 'up' | 'down') {
    e.stopPropagation();
    if (isSignedIn === false) {
      openSignIn();
      return;
    }
    if (!isSignedIn) return;
    navigator.vibrate?.(10);
    await react(card.id, type);
    capture('card_reacted', { card_id: card.id, reaction: type });
  }

  // ── Save handler ──

  async function handleSave(e: React.MouseEvent) {
    e.stopPropagation();
    if (isSignedIn === false) {
      openSignIn();
      return;
    }
    if (!isSignedIn) return;
    try {
      navigator.vibrate?.([15, 60, 15]);
      const nowSaved = await toggleSave(card.id, card);
      capture(nowSaved ? 'card_saved' : 'card_unsaved', { card_id: card.id });
      toast(nowSaved ? 'Saved' : 'Removed from saved');
    } catch {
      toast('Failed to save. Try again.');
    }
  }

  const meta = [extractDomain(card.canonical_url), relativeTime(card.published_at)]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="hx-card h-full" data-category={card.category}>
      {/* 01 · header field: the dither grid, always. It's a signature of the card and
          the badge overlaps its faded lower edge — cover art goes lower, in the body's
          empty space (block 06), so the grid is never hidden. */}
      <div className="hx-dither" aria-hidden="true" />

      {/* 02 · badge overlaps the faded lower half of the field */}
      <div className="hx-badge-row">
        <span className="hx-badge">{categoryLabel.toUpperCase()}</span>
        {position && (
          <span className="hx-position">
            {pad(position.index)}/{pad(position.total)}
          </span>
        )}
      </div>

      <div className="hx-body-block">
        {/* 03 · two lines, survives three */}
        <h2 className="hx-headline">{card.headline}</h2>

        {/* 04 · stat row — conditional. Renders only when the pipeline extracted 2+
            figures, each guaranteed verbatim from the summary (#55). Capped at 3 so a
            stray 4th pair can't break the layout. Absent on every card until the
            extraction migration populates the column. */}
        {card.stats && card.stats.length >= 2 && (
          <div className="hx-stats">
            {card.stats.slice(0, 3).map((s, i) => (
              <div key={i} className="hx-stat">
                <span className="hx-stat-value">{s.value}</span>
                <span className="hx-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* 05 · identifiers and quantities step into mono so EIP-7702 and v1.16.4
            read as tokens rather than words */}
        <p className="hx-summary">
          {splitFigures(card.summary).map((seg, i) =>
            seg.figure ? (
              <span key={i} className="hx-fig">
                {seg.text}
              </span>
            ) : (
              seg.text
            ),
          )}
        </p>
      </div>

      {/* 06 · cover art fills the empty lower space when the pipeline produced an
          image; otherwise a plain spacer. Either way it flex-grows to absorb the
          45-67 word swing so the action bar cannot move between cards (which would
          make the save button a moving target under a thumb). The image is abstract
          texture, not information, so it's hidden from assistive tech. */}
      {card.image_url && !imgFailed ? (
        <img
          className="hx-cardimg"
          src={card.image_url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="hx-spacer" />
      )}

      {/* 07 */}
      <div className="hx-meta">{meta.toUpperCase()}</div>

      {/* 08 · pinned to the card foot */}
      <div className="hx-actions">
        <button
          className="hx-ctl"
          onClick={handleSave}
          aria-pressed={saved}
          aria-label={saved ? 'Remove from saved' : 'Save card'}
        >
          <svg width="17" height="17" viewBox="0 0 20 20" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <path d="M5.5 3.5h9v13l-4.5-3.4-4.5 3.4z" />
          </svg>
        </button>

        <div className="hx-vote">
          <button className="hx-vote-up" onClick={(e) => handleReaction(e, 'up')} aria-pressed={userReaction === 'up'} aria-label="Signal">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3.6l4.8 8H3.2z" />
            </svg>
            <span>{counts.up}</span>
          </button>
          <div className="hx-vote-sep" aria-hidden="true" />
          <button className="hx-vote-down" onClick={(e) => handleReaction(e, 'down')} aria-pressed={userReaction === 'down'} aria-label="Noise">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12.4L3.2 4.4h9.6z" />
            </svg>
            <span>{counts.down}</span>
          </button>
        </div>

        <div ref={shareRef} style={{ position: 'relative' }}>
          <button className="hx-ctl" onClick={(e) => { e.stopPropagation(); setShareOpen((v) => !v); }} aria-expanded={shareOpen} aria-label="Share card">
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="14.4" cy="5.2" r="2.1" />
              <circle cx="5.6" cy="10" r="2.1" />
              <circle cx="14.4" cy="14.8" r="2.1" />
              <path d="M7.5 8.9l4.9-2.5M7.5 11.1l4.9 2.5" />
            </svg>
          </button>
          {shareOpen && (
            <div className="hx-sheet" role="menu">
              <button role="menuitem" onClick={shareOnX}>Share on X</button>
              <button role="menuitem" onClick={shareOnTelegram}>Share on Telegram</button>
              <button role="menuitem" onClick={copyLink}>Copy link</button>
            </div>
          )}
        </div>

        <button className="hx-flag" onClick={handleFlagClick} disabled={flagged} aria-label={flagged ? 'Already flagged' : 'Flag this card'}>
          {flagged ? 'FLAGGED' : 'FLAG'}
        </button>
      </div>

      {/* Flag flow. Covers the card rather than floating over the feed, so the
          gesture that dismisses it cannot be confused with a scroll. */}
      {flagStep !== 'idle' && (
        <div className="hx-flag-overlay" role="dialog" aria-modal="true">
          {flagStep === 'reason' && (
            <>
              <span className="hx-flag-title">What is wrong with this card?</span>
              {FLAG_REASONS.map((r) => (
                <button key={r} className="hx-flag-option" onClick={() => selectReason(r)}>
                  {r}
                </button>
              ))}
              {flagReason === 'Other' && (
                <div className="hx-flag-other">
                  <input
                    value={flagCustom}
                    onChange={(e) => setFlagCustom(e.target.value)}
                    placeholder="Tell us briefly"
                    maxLength={200}
                    aria-label="Reason"
                  />
                  <button onClick={confirmOtherReason} disabled={!flagCustom.trim()}>
                    Next
                  </button>
                </div>
              )}
              <button className="hx-flag-cancel" onClick={() => setFlagStep('idle')}>
                Cancel
              </button>
            </>
          )}

          {flagStep === 'confirm' && (
            <>
              <span className="hx-flag-title">Flag as “{flagReason}”?</span>
              <p className="hx-flag-note">
                Enough independent flags take a card out of the feed.
              </p>
              <button className="hx-flag-option" onClick={submitFlag}>
                Submit flag
              </button>
              <button className="hx-flag-cancel" onClick={() => setFlagStep('idle')}>
                Cancel
              </button>
            </>
          )}

          {flagStep === 'done' && <span className="hx-flag-title">Thanks, logged.</span>}
        </div>
      )}
    </article>
  );
});
