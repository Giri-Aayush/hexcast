import { headers } from 'next/headers';
import { auth as betterAuth } from './auth';

/**
 * Server-side session lookup with the shape the codebase already speaks.
 *
 * Every API route and server component was written against Clerk's
 * `const { userId } = await auth()`. Keeping that contract makes the provider
 * swap (#25) mechanical — one import changes per file, no destructuring churn,
 * and the route tests keep their mock shape.
 */
export async function auth(): Promise<{ userId: string | null }> {
  const session = await betterAuth.api.getSession({ headers: await headers() });
  return { userId: session?.user?.id ?? null };
}
