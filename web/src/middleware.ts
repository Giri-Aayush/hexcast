import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

async function rateLimit(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return null;
  }

  // Netlify sets x-nf-client-connection-ip to the real TCP peer — not
  // client-appendable, so it cannot be spoofed to dodge the per-IP cooldown. The
  // leftmost x-forwarded-for token IS client-controllable, so it is only the local
  // fallback, never trusted ahead of the header Netlify sets itself.
  const ip =
    request.headers.get('x-nf-client-connection-ip')?.trim() ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const { allowed, remaining } = await checkRateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Remaining', String(remaining));
  return response;
}

// The app requires an account: these prefixes redirect a signed-out visitor to
// sign-in. Deliberately NOT gated and staying public: `/` (the landing), `/sign-in`,
// `/card/*` (shareable permalinks — the whole point of the share button), and the
// auth/stats APIs. So "nobody sees the feed without signing up" holds, but a shared
// card link and the marketing page still work for a logged-out visitor.
const GATED_PREFIXES = ['/feed', '/saved', '/sources', '/about', '/admin'];

function needsAuth(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Cookie presence, not validation — Better Auth's session is validated server-side
// (it needs the DB, which the edge middleware can't reach). This is the fast gate so
// the feed never renders for an obviously-signed-out visitor; the page-level auth()
// check is the real backstop for a stale or forged cookie. `.includes` covers the
// `__Secure-` prefix production adds over https.
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.includes('better-auth.session_token'));
}

export default async function middleware(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const { pathname } = request.nextUrl;
  if (needsAuth(pathname) && !hasSessionCookie(request)) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
