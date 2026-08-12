'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from './auth-client';

/**
 * The auth UI vocabulary the app already speaks — SignedIn, SignedOut,
 * SignInButton, UserButton — reimplemented on Better Auth (#25).
 *
 * Clerk shipped these as hosted components; these are ours, which is the point:
 * they render in the app's own design language instead of a vendor's. Sign-in
 * lives at /sign-in rather than in a vendor modal.
 */

export function useUser() {
  const { data, isPending } = useSession();
  return {
    isLoaded: !isPending,
    isSignedIn: !!data?.user,
    user: data?.user ?? null,
  };
}

/** Clerk's `useClerk().openSignIn()` call sites map here. */
export function useAuthActions() {
  const router = useRouter();
  return {
    openSignIn: () => router.push('/sign-in'),
    signOut: async () => {
      await signOut();
      router.refresh();
    },
  };
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || !isSignedIn) return null;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded || isSignedIn) return null;
  return <>{children}</>;
}

/**
 * Wraps its child button and routes it to /sign-in. The `mode` prop Clerk used
 * ("modal") is accepted and ignored so call sites need no edits.
 */
export function SignInButton({ children }: { children: React.ReactElement; mode?: string }) {
  const router = useRouter();
  return (
    <span onClick={() => router.push('/sign-in')} style={{ display: 'contents' }}>
      {children}
    </span>
  );
}

export function SignOutButton({ children }: { children: React.ReactElement }) {
  const { signOut: doSignOut } = useAuthActions();
  return (
    <span onClick={() => void doSignOut()} style={{ display: 'contents' }}>
      {children}
    </span>
  );
}

/** The app-bar avatar: initials on ink, linking to the You page. */
export function UserButton(_props: { appearance?: unknown }) {
  const { user } = useUser();
  if (!user) return null;
  const initials =
    (user.name ?? user.email ?? '?')
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <Link href="/about" className="hx-avatar" aria-label="Your account">
      {initials}
    </Link>
  );
}
