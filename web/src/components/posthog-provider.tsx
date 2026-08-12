'use client';

import { useEffect } from 'react';
import { useUser } from '@/lib/auth-ui';
import posthog from 'posthog-js';

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, user } = useUser();

  useEffect(() => {
    // Skip if PostHog was not initialized (missing key)
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;

    if (isSignedIn && user) {
      posthog.identify(user.id, {
        email: user.email,
        name: user.name,
        avatar: user.image,
      });
    } else if (isSignedIn === false) {
      posthog.reset();
    }
  }, [isSignedIn, user]);

  return <>{children}</>;
}
