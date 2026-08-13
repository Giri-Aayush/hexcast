import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { dash, sentinel } from '@better-auth/infra';
import { Pool } from 'pg';

/**
 * Better Auth Infra (dashboard/analytics + abuse protection) activates only when
 * its credentials exist — one gate for all three vars, so a half-configured
 * environment stays a clean no-op instead of a plugin erroring at runtime.
 * Get keys from the Better Auth Infra dashboard; set all three or none.
 */
// Gate on key AND apiUrl. Measured, not assumed: with only the key set, the
// plugin builds fetch('/security/check') from an undefined apiUrl and errors on
// every auth request (failing open, but noisily and doing nothing). kvUrl stays
// optional. If onboarding only surfaced the key, the API URL is on the same
// dashboard — do not activate without it.
const infraConfigured =
  !!process.env.BETTER_AUTH_API_KEY && !!process.env.BETTER_AUTH_API_URL;

const infraPlugins = infraConfigured
  ? [
      dash({
        apiUrl: process.env.BETTER_AUTH_API_URL,
        kvUrl: process.env.BETTER_AUTH_KV_URL,
        apiKey: process.env.BETTER_AUTH_API_KEY,
      }),
      sentinel({
        apiUrl: process.env.BETTER_AUTH_API_URL,
        kvUrl: process.env.BETTER_AUTH_KV_URL,
        apiKey: process.env.BETTER_AUTH_API_KEY,
      }),
    ]
  : [];

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

  // Google sign-in activates only when both halves of the OAuth credential are set,
  // same gate pattern as the infra plugins above — a half-configured env stays a
  // clean no-op instead of erroring on every social request. The client button is
  // behind NEXT_PUBLIC_GOOGLE_AUTH_ENABLED, so keep the three in sync. Google's
  // authorized redirect URI is <origin>/api/auth/callback/google.
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        },
      }
    : {}),

  advanced: {
    ipAddress: {
      // We deploy behind Netlify's CDN, so every request's TCP peer is Netlify —
      // Better Auth's rate limiter would otherwise throttle the whole site as one
      // client. `x-nf-client-connection-ip` is the real client IP Netlify sets
      // itself; unlike the leftmost `x-forwarded-for` token it is not
      // client-appendable, so it is safe to trust. XFF is the fallback for any
      // context Netlify does not set the first (e.g. local dev). Their docs steer
      // to a single proxy-set header over the XFF chain for exactly this reason.
      ipAddressHeaders: ['x-nf-client-connection-ip', 'x-forwarded-for'],
    },
  },

  // nextCookies must be last: it is what lets server actions set the session
  // cookie through Next's cookie store instead of raw headers.
  plugins: [...infraPlugins, nextCookies()],
});
