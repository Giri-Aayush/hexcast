'use client';

import { createAuthClient } from 'better-auth/react';

/** Browser-side auth. Same-origin, so no baseURL needed. */
export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut } = authClient;
