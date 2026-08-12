import { auth } from '@/lib/server-auth';

const ADMIN_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

/**
 * True when nobody at all can moderate.
 *
 * An empty ADMIN_USER_IDS makes isAdmin() return false for every caller including
 * the owner, which is a reasonable default — it fails closed — but it fails closed
 * *silently*. Flags pile up, /admin 404s for everyone, and nothing anywhere says
 * why. Exposed so /api/health can report it as a real state instead of leaving it
 * to be discovered.
 */
export function isModerationConfigured(): boolean {
  return ADMIN_IDS.size > 0;
}

export async function isAdmin(): Promise<{ admin: boolean; userId: string | null }> {
  const { userId } = await auth();
  if (!userId) return { admin: false, userId: null };

  if (ADMIN_IDS.size === 0) {
    // Signed in, and there is no moderator list to be on. Logged rather than
    // silently denied so the reason shows up in production logs the first time
    // someone tries to reach /admin.
    console.warn(
      '[admin] ADMIN_USER_IDS is empty, so no user can moderate. ' +
        `Set it to a comma-separated list of Clerk user ids; this caller is ${userId}.`,
    );
  }

  return { admin: ADMIN_IDS.has(userId), userId };
}
