'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, signUp } from '@/lib/auth-client';

/**
 * Sign-in and sign-up on one screen, styled on the 3d soft wall: dark panel on the
 * light ground, one clear action. Clerk's hosted modal is gone (#25); this is ours.
 */
export default function SignInPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const res =
      mode === 'in'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name.trim() || email.split('@')[0] });

    setBusy(false);
    if (res.error) {
      // Better Auth's messages are already human ("Invalid email or password").
      setError(res.error.message ?? 'Something went wrong. Try again.');
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="hx-page hx-signin">
      <header className="hx-page-head">
        <Link href="/" className="hx-wordmark">
          hexcast<span>.</span>
        </Link>
      </header>

      <div className="hx-wall">
        <div className="hx-wall-kicker">
          {mode === 'in' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}
        </div>
        <h1>
          {mode === 'in' ? 'Sign in to keep your cards.' : 'One account, every device.'}
        </h1>
        <p>
          An account saves cards across devices, remembers your filters, and lets you
          vote on accuracy.
        </p>

        <form onSubmit={submit} className="hx-wall-form">
          {mode === 'up' && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              autoComplete="name"
              aria-label="Name"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            required
            aria-label="Email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={8}
            aria-label="Password"
          />

          {error && (
            <p className="hx-wall-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="hx-wall-cta" disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          type="button"
          className="hx-wall-switch"
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
        >
          {mode === 'in' ? 'NEW HERE? CREATE AN ACCOUNT' : 'ALREADY HAVE ONE? SIGN IN'}
        </button>
      </div>
    </main>
  );
}
