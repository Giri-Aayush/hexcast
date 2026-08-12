import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

// All Better Auth endpoints (sign-in, sign-up, session, sign-out) mount here.
export const { GET, POST } = toNextJsHandler(auth.handler);
