'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePathname } from 'next/navigation';
import { toast } from './toast';
import { capture } from '@/lib/posthog';

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { isSignedIn } = useUser();
  const pathname = usePathname();

  // ESC key to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Only show for signed-in users, hide on feed page (cards have their own actions)
  if (!isSignedIn || pathname === '/') return null;

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          page_url: window.location.pathname,
        }),
      });

      if (res.ok) {
        capture('feedback_submitted', { length: message.trim().length });
        toast('Thanks for the feedback');
        setMessage('');
        setOpen(false);
      } else {
        toast('Failed to send — try again');
      }
    } catch {
      toast('Failed to send — try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {/* Trigger — bottom-right, above the nav pill */}
      {!open && (
        <button onClick={() => setOpen(true)} className="hx-fb-trigger">
          FEEDBACK
        </button>
      )}

      {open && (
        <>
          <div className="hx-fb-scrim" onClick={() => setOpen(false)} />

          <div className="hx-fb-wrap" role="dialog" aria-modal="true" aria-label="Send feedback">
            <div className="hx-fb-panel">
              <div className="hx-sheet-head">
                <span>FEEDBACK</span>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  ESC
                </button>
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                placeholder="What's on your mind?"
                rows={3}
                autoFocus
                className="hx-fb-input"
              />
              <div className="hx-fb-foot">
                <span>{message.length}/500</span>
                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || submitting}
                  className="hx-btn-ink"
                >
                  {submitting ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
