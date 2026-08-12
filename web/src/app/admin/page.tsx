'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/lib/auth-ui';

interface FlagItem {
  id: string;
  card_id: string;
  user_id: string;
  reason: string | null;
  reported_at: string;
  cards: {
    id: string;
    headline: string;
    summary: string;
    category: string;
    canonical_url: string;
    source_id: string;
    is_suspended: boolean;
  } | null;
}

interface CardItem {
  id: string;
  headline: string;
  summary: string;
  category: string;
  source_id: string;
  canonical_url: string;
  published_at: string;
  quality_score: number | null;
  flag_count: number;
  is_suspended: boolean;
}

type Tab = 'flags' | 'cards';

export default function AdminPage() {
  const { isLoaded, isSignedIn } = useUser();
  const [tab, setTab] = useState<Tab>('flags');
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [cards, setCards] = useState<CardItem[]>([]);
  const [search, setSearch] = useState('');
  const [showSuspended, setShowSuspended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    if (tab === 'flags') loadFlags();
    else loadCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, tab, showSuspended]);

  async function loadFlags() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/admin/flags');
    if (!res.ok) {
      setError(res.status === 403 ? 'Access denied — you are not an admin.' : 'Failed to load flags');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setFlags(data.flags);
    setLoading(false);
  }

  async function loadCards() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (showSuspended) params.set('suspended', 'true');
    const res = await fetch(`/api/admin/cards?${params}`);
    if (!res.ok) {
      setError(res.status === 403 ? 'Access denied — you are not an admin.' : 'Failed to load cards');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCards(data.cards);
    setLoading(false);
  }

  async function handleFlagAction(flagId: string, action: 'resolve' | 'suspend') {
    const res = await fetch('/api/admin/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flag_id: flagId, action }),
    });
    if (res.ok) {
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    }
  }

  async function handleCardAction(cardId: string, action: 'suspend' | 'unsuspend' | 'delete') {
    if (action === 'delete' && !confirm('Delete this card permanently?')) return;
    const res = await fetch('/api/admin/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, action }),
    });
    if (res.ok) {
      if (action === 'delete') {
        setCards((prev) => prev.filter((c) => c.id !== cardId));
      } else {
        setCards((prev) =>
          prev.map((c) =>
            c.id === cardId ? { ...c, is_suspended: action === 'suspend' } : c,
          ),
        );
      }
    }
  }

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--ground)' }}>
        <p style={{ color: 'var(--ink-dim)' }}>Sign in required</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-auto pb-24" style={{ background: 'var(--ground)' }}>
      <div className="max-w-5xl mx-auto px-5 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <h1 className="text-lg font-semibold tracking-widest uppercase" style={{ color: 'var(--ink)' }}>
            <span style={{ color: 'var(--ink)' }}>[</span> Admin <span style={{ color: 'var(--ink)' }}>]</span>
          </h1>
          <a href="/" className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--ink-dim)' }}>
            Back to feed
          </a>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--line)' }}>
          {(['flags', 'cards'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-[11px] font-medium tracking-widest uppercase transition-colors"
              style={{
                color: tab === t ? 'var(--ink)' : 'var(--ink-dim)',
                borderBottom: tab === t ? '2px solid var(--ink)' : '2px solid transparent',
              }}
            >
              {t === 'flags' ? `Flags (${flags.length})` : 'Cards'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 text-[12px]" style={{ background: '#1a0000', border: '1px solid #ff4444', color: '#ff6666' }}>
            {error}
          </div>
        )}

        {/* Flags tab */}
        {tab === 'flags' && (
          <div className="space-y-3">
            {loading ? (
              <p className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Loading flags...</p>
            ) : flags.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>No unresolved flags</p>
            ) : (
              flags.map((flag) => (
                <div
                  key={flag.id}
                  className="p-4"
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: 'var(--ink)' }}>
                        {flag.cards?.headline ?? 'Unknown card'}
                      </p>
                      <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ink)' }}>
                        {flag.cards?.summary}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--ink)' }}>
                          {flag.cards?.category}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                          {flag.cards?.source_id}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                          {new Date(flag.reported_at).toLocaleDateString()}
                        </span>
                      </div>
                      {flag.reason && (
                        <p className="text-[11px] mt-2 px-2 py-1 inline-block" style={{ background: 'var(--ground)', color: 'var(--ink)' }}>
                          Reason: {flag.reason}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => handleFlagAction(flag.id, 'resolve')}
                        className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase"
                        style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                      >
                        Dismiss
                      </button>
                      <button
                        onClick={() => handleFlagAction(flag.id, 'suspend')}
                        className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase"
                        style={{ background: '#cc2200', color: '#fff' }}
                      >
                        Suspend
                      </button>
                      <a
                        href={flag.cards?.canonical_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase text-center"
                        style={{ border: '1px solid var(--ink)', color: 'var(--ink)' }}
                      >
                        Source
                      </a>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Cards tab */}
        {tab === 'cards' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                placeholder="Search headlines..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadCards()}
                className="flex-1 px-3 py-2 text-[12px]"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--ink)', outline: 'none' }}
              />
              <label className="flex items-center gap-2 text-[11px] cursor-pointer" style={{ color: 'var(--ink-dim)' }}>
                <input
                  type="checkbox"
                  checked={showSuspended}
                  onChange={(e) => setShowSuspended(e.target.checked)}
                />
                Suspended only
              </label>
              <button
                onClick={loadCards}
                className="px-4 py-2 text-[10px] font-medium tracking-wider uppercase"
                style={{ background: 'var(--ink)', color: '#fff' }}
              >
                Search
              </button>
            </div>

            <div className="space-y-2">
              {loading ? (
                <p className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Loading cards...</p>
              ) : cards.length === 0 ? (
                <p className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>No cards found</p>
              ) : (
                cards.map((card) => (
                  <div
                    key={card.id}
                    className="px-4 py-3 flex items-center gap-4"
                    style={{
                      background: card.is_suspended ? '#1a0a0a' : 'var(--surface)',
                      border: `1px solid ${card.is_suspended ? '#cc2200' : 'var(--line)'}`,
                      opacity: card.is_suspended ? 0.7 : 1,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate" style={{ color: 'var(--ink)' }}>
                        {card.headline}
                        {card.is_suspended && <span style={{ color: '#cc2200' }}> [SUSPENDED]</span>}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--ink)' }}>{card.category}</span>
                        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{card.source_id}</span>
                        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                          Q: {card.quality_score?.toFixed(2) ?? '—'}
                        </span>
                        {card.flag_count > 0 && (
                          <span className="text-[10px]" style={{ color: '#cc2200' }}>
                            {card.flag_count} flag{card.flag_count > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                          {new Date(card.published_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {card.is_suspended ? (
                        <button
                          onClick={() => handleCardAction(card.id, 'unsuspend')}
                          className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase"
                          style={{ border: '1px solid var(--ink)', color: 'var(--ink)' }}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCardAction(card.id, 'suspend')}
                          className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase"
                          style={{ border: '1px solid #cc2200', color: '#cc2200' }}
                        >
                          Suspend
                        </button>
                      )}
                      <button
                        onClick={() => handleCardAction(card.id, 'delete')}
                        className="px-3 py-1.5 text-[10px] font-medium tracking-wider uppercase"
                        style={{ background: '#cc2200', color: '#fff' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
