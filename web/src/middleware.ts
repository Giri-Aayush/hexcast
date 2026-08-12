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

// Better Auth needs no middleware wrapper — sessions are cookie + database, read
// where they are used. Middleware is rate limiting alone now.
export default async function middleware(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
