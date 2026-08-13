import type { Metadata } from 'next';
import { SignInForm } from './sign-in-form';

// Own title instead of inheriting the homepage's. Sign-in isn't indexed (robots
// disallows it), but the tab/title still shouldn't read as the marketing homepage.
export const metadata: Metadata = { title: 'Sign in · Hexcast' };

// Read the Google config at request time, not build time. force-dynamic keeps this a
// server render so the button flips on the next request after the env is set, with no
// rebuild and no separate NEXT_PUBLIC flag to remember.
export const dynamic = 'force-dynamic';

export default function SignInPage() {
  // Show the button exactly when the provider will actually work: both halves of the
  // OAuth credential present. Same condition the server auth config gates the provider
  // on, so the button and the backend can never disagree.
  const googleEnabled =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  return <SignInForm googleEnabled={googleEnabled} />;
}
