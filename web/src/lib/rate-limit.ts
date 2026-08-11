const WINDOW_MS = 60_000;
const MAX_REQUESTS = 300;

// Counters live in a shared store when one is configured, and in process memory
// otherwise. In-memory is correct for `next dev` and for tests, but on serverless it is
// per-isolate: every instance keeps its own tally and a cold start hands out a fresh
// budget, so the effective ceiling is MAX_REQUESTS multiplied by however many instances
// happen to be warm. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in
// production to make the limit mean what it says.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useSharedStore = Boolean(REDIS_URL && REDIS_TOKEN);

const ipRequestMap = new Map<string, { count: number; resetAt: number }>();

// Per-user rate limiting: keyed by "userId:action"
const userRequestMap = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every minute. Only meaningful for a long-lived process (dev);
// a serverless isolate is usually gone before this fires, which is fine — the map dies
// with it.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of ipRequestMap) {
      if (data.resetAt < now) ipRequestMap.delete(ip);
    }
    for (const [key, data] of userRequestMap) {
      if (data.resetAt < now) userRequestMap.delete(key);
    }
  }, 60_000);
}

interface Result {
  allowed: boolean;
  remaining: number;
}

function checkInMemory(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  maxRequests: number,
  windowMs: number,
): Result {
  const now = Date.now();
  const record = store.get(key);

  if (!record || record.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  record.count++;
  const remaining = Math.max(0, maxRequests - record.count);
  return { allowed: record.count <= maxRequests, remaining };
}

/**
 * Fixed-window counter in Redis: INCR the key, then set its TTL only if it has none, so
 * the window starts at the first request and is not extended by later ones.
 *
 * Returns null when the store cannot be reached, which the callers treat as "allow".
 * A news feed would rather serve traffic it should have throttled than turn away every
 * reader because a counter is unavailable.
 */
async function checkRedis(key: string, maxRequests: number, windowMs: number): Promise<Result | null> {
  const ttlSeconds = Math.ceil(windowMs / 1000);

  try {
    const response = await fetch(`${REDIS_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, String(ttlSeconds), 'NX'],
      ]),
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const body = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    const count = Number(body?.[0]?.result);
    if (!Number.isFinite(count)) return null;

    return { allowed: count <= maxRequests, remaining: Math.max(0, maxRequests - count) };
  } catch {
    return null;
  }
}

async function check(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<Result> {
  if (useSharedStore) {
    const shared = await checkRedis(key, maxRequests, windowMs);
    if (shared) return shared;
    // Store unreachable — fall through to the local counter rather than failing closed.
  }
  return checkInMemory(store, key, maxRequests, windowMs);
}

/** Global IP-based rate limiter (300 req/min) */
export function checkRateLimit(ip: string): Promise<Result> {
  return check(ipRequestMap, `rl:ip:${ip}`, MAX_REQUESTS, WINDOW_MS);
}

/** Per-user rate limiter for specific actions */
export function checkUserRateLimit(
  userId: string,
  action: string,
  maxRequests: number,
  windowMs: number,
): Promise<Result> {
  return check(userRequestMap, `rl:user:${userId}:${action}`, maxRequests, windowMs);
}
