import { NextRequest, NextResponse } from 'next/server';

/**
 * Reports how the client IP arrives at this route, so the auth session IP can be fixed from
 * fact rather than from a plausible guess at the proxy topology.
 *
 * WHY THIS EXISTS: every Better Auth session on production stored an AWS ap-southeast-1
 * address — 13.229.72.253, 18.136.210.127 and three siblings across 14 sessions — so the
 * dashboard reports every user as being in Singapore, including people who signed up from
 * India. The stored value is our own infrastructure, not the visitor.
 *
 * Better Auth resolves the IP by walking `advanced.ipAddress.ipAddressHeaders` in order and
 * handing each value to a parser that, with no `trustedProxies` configured, accepts a header
 * ONLY when it holds exactly one address:
 *
 *   // Without valid trusted proxies a multi-hop chain is unresolvable.
 *   if (forwardedIps.length !== 1) return null;
 *
 * So something is handing it a single-valued header containing a Netlify address. Which one
 * decides the fix, and the two candidates need opposite changes:
 *
 *   x-nf-client-connection-ip carries a proxy hop  -> stop trusting it, or trust it later
 *   x-forwarded-for arrives single-valued          -> reorder, or configure trustedProxies
 *
 * Guessing between those in production auth is how you trade a cosmetic bug for a subtler one,
 * so this route measures instead.
 *
 * SAFE TO EXPOSE: a caller sees only their own address, which they already know, plus which
 * proxy headers we receive — and `server: Netlify` is already in every response header. It
 * reveals no other user's data and takes no input.
 *
 * TEMPORARY. Delete it once the session IP is confirmed correct; a debug endpoint that
 * outlives its question becomes furniture nobody dares remove.
 */

/** Every header a CDN or proxy might use to carry the originating address. */
const IP_HEADERS = [
  'x-nf-client-connection-ip',
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
  'x-cluster-client-ip',
  'forwarded',
] as const;

/**
 * Better Auth's rule, reimplemented exactly: with no trusted proxies, a header resolves only
 * when it holds a single address. Repeated here rather than imported so the report shows what
 * the library WOULD do without depending on its internals staying importable.
 */
function wouldResolve(value: string): { resolves: boolean; hops: number; reason: string } {
  const hops = value.split(',').map((v) => v.trim()).filter(Boolean);
  if (hops.length === 0) return { resolves: false, hops: 0, reason: 'empty' };
  if (hops.length !== 1) {
    return { resolves: false, hops: hops.length, reason: 'multi-hop chain, needs trustedProxies' };
  }
  return { resolves: true, hops: 1, reason: 'single address, accepted' };
}

export async function GET(request: NextRequest) {
  const present = IP_HEADERS.map((name) => {
    const value = request.headers.get(name);
    if (value === null) return { header: name, present: false as const };
    return { header: name, present: true as const, value, ...wouldResolve(value) };
  });

  // The first header that would actually yield an address, in our configured order — this is
  // the value Better Auth stores on the session and the dashboard geolocates.
  const configuredOrder = ['x-nf-client-connection-ip', 'x-forwarded-for'];
  const resolved =
    configuredOrder
      .map((name) => {
        const value = request.headers.get(name);
        if (!value) return null;
        const check = wouldResolve(value);
        return check.resolves ? { via: name, ip: value.trim() } : null;
      })
      .find(Boolean) ?? null;

  return NextResponse.json(
    {
      note: 'Temporary diagnostic. The address below is yours; no other user data is exposed.',
      resolvedByBetterAuth: resolved,
      headers: present,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
