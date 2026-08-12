import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { Pool } from 'pg';

/**
 * Server-side Better Auth instance. Replaces Clerk (#25).
 *
 * Auth is the one thing in web/ that talks to Postgres directly rather than
 * through PostgREST: Better Auth owns its user/session/account/verification
 * tables (migrations 021/022) and needs real SQL for them. Everything else keeps
 * going through the Supabase client — DATABASE_URL is for auth only.
 *
 * Locally: postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Production: the Supabase direct connection string, set in Netlify.
 */
export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),

  emailAndPassword: {
    enabled: true,
  },

  // nextCookies must be last: it is what lets server actions set the session
  // cookie through Next's cookie store instead of raw headers.
  plugins: [nextCookies()],
});
