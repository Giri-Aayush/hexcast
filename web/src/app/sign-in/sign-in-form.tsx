'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, signUp } from '@/lib/auth-client';

/**
 * Sign-in and sign-up on one screen, styled on the 3d soft wall: dark panel on the
 * light ground, one clear action. Clerk's hosted modal is gone (#25); this is ours.
 *
 * `googleEnabled` comes from the server page, which reads it from the live env at
 * request time — so the button appears exactly when the provider is configured, with
 * no separate build-time flag to keep in sync.
 */
export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The landing sign-up box funnels here as /sign-in?mode=up&email=... Read it on the
  // client (no Suspense boundary needed, unlike useSearchParams) to prefill the form
  // and open straight in create-account mode. Also handle the OAuth error Better Auth
  // sends back (see the `google` handler / errorCallbackURL below).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'up') setMode('up');
    const prefill = params.get('email');
    if (prefill) setEmail(prefill);
    // account_not_linked: this email already has an email/password account, and we
    // deliberately don't auto-merge it with Google. Put them in sign-in mode and say so.
    if (params.get('error') === 'account_not_linked') {
      setMode('in');
      setError('You already have an account with this email. Sign in with your password below.');
    }
  }, []);

  async function google() {
    if (busy) return;
    setBusy(true);
    setError(null);
    // Better Auth redirects to Google and back to callbackURL on success. On failure it
    // redirects to errorCallbackURL with ?error=..., which the effect above reads — so
    // the account_not_linked case lands back here with a clear message instead of on the
    // landing page with a raw error code.
    const res = await signIn.social({
      provider: 'google',
      callbackURL: '/feed',
      errorCallbackURL: '/sign-in',
    });
    if (res?.error) {
      setError(res.error.message ?? 'Could not reach Google. Try again.');
      setBusy(false);
    }
  }

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
    router.push('/feed');
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

        {googleEnabled && (
          <>
            <button
              type="button"
              className="hx-wall-google"
              onClick={google}
              disabled={busy}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              Continue with Google
            </button>
            <div className="hx-wall-or" aria-hidden="true">or</div>
          </>
        )}

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
