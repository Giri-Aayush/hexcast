import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let checkRateLimit: typeof import('../rate-limit').checkRateLimit;
let checkUserRateLimit: typeof import('../rate-limit').checkUserRateLimit;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const mod = await import('../rate-limit');
  checkRateLimit = mod.checkRateLimit;
  checkUserRateLimit = mod.checkUserRateLimit;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkRateLimit', () => {
  it('allows the first request with 299 remaining', async () => {
    const result = await checkRateLimit('192.168.1.1');
    expect(result).toEqual({ allowed: true, remaining: 299 });
  });

  it('allows up to 300 requests', async () => {
    for (let i = 0; i < 299; i++) {
      await checkRateLimit('10.0.0.1');
    }
    const result = await checkRateLimit('10.0.0.1');
    expect(result).toEqual({ allowed: true, remaining: 0 });
  });

  it('denies request #301', async () => {
    for (let i = 0; i < 300; i++) {
      await checkRateLimit('10.0.0.2');
    }
    const result = await checkRateLimit('10.0.0.2');
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  it('resets after the window expires', async () => {
    for (let i = 0; i < 300; i++) {
      await checkRateLimit('10.0.0.3');
    }
    // Advance past the 60s window
    vi.advanceTimersByTime(61_000);
    const result = await checkRateLimit('10.0.0.3');
    expect(result).toEqual({ allowed: true, remaining: 299 });
  });

  it('tracks different IPs independently', async () => {
    for (let i = 0; i < 300; i++) {
      await checkRateLimit('10.0.0.4');
    }
    // IP 10.0.0.4 is exhausted, but 10.0.0.5 is fresh
    const result = await checkRateLimit('10.0.0.5');
    expect(result).toEqual({ allowed: true, remaining: 299 });
  });
});

describe('checkUserRateLimit', () => {
  it('allows the first request with custom limits', async () => {
    const result = await checkUserRateLimit('user1', 'vote', 10, 30_000);
    expect(result).toEqual({ allowed: true, remaining: 9 });
  });

  it('denies requests exceeding custom limit', async () => {
    for (let i = 0; i < 10; i++) {
      await checkUserRateLimit('user2', 'vote', 10, 30_000);
    }
    const result = await checkUserRateLimit('user2', 'vote', 10, 30_000);
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });

  it('treats different userId:action combos independently', async () => {
    for (let i = 0; i < 5; i++) {
      await checkUserRateLimit('user3', 'vote', 5, 30_000);
    }
    // user3:vote is exhausted, but user4:vote is fresh
    const result = await checkUserRateLimit('user4', 'vote', 5, 30_000);
    expect(result).toEqual({ allowed: true, remaining: 4 });
  });

  it('resets after custom window expires', async () => {
    for (let i = 0; i < 5; i++) {
      await checkUserRateLimit('user5', 'flag', 5, 20_000);
    }
    vi.advanceTimersByTime(21_000);
    const result = await checkUserRateLimit('user5', 'flag', 5, 20_000);
    expect(result).toEqual({ allowed: true, remaining: 4 });
  });

  it('tracks the same user with different actions separately', async () => {
    for (let i = 0; i < 3; i++) {
      await checkUserRateLimit('user6', 'vote', 3, 30_000);
    }
    // user6:vote is exhausted, but user6:flag is fresh
    const result = await checkUserRateLimit('user6', 'flag', 3, 30_000);
    expect(result).toEqual({ allowed: true, remaining: 2 });
  });

  it('returns correct remaining count as requests are made', async () => {
    await checkUserRateLimit('user7', 'share', 5, 30_000);
    expect(await checkUserRateLimit('user7', 'share', 5, 30_000)).toEqual({
      allowed: true,
      remaining: 3,
    });
    expect(await checkUserRateLimit('user7', 'share', 5, 30_000)).toEqual({
      allowed: true,
      remaining: 2,
    });
    expect(await checkUserRateLimit('user7', 'share', 5, 30_000)).toEqual({
      allowed: true,
      remaining: 1,
    });
    expect(await checkUserRateLimit('user7', 'share', 5, 30_000)).toEqual({
      allowed: true,
      remaining: 0,
    });
  });

  it('remaining count is correct at boundary (last allowed request)', async () => {
    for (let i = 0; i < 9; i++) {
      await checkUserRateLimit('user8', 'boundary', 10, 30_000);
    }
    // Request #10 should be allowed with remaining: 0
    const result = await checkUserRateLimit('user8', 'boundary', 10, 30_000);
    expect(result).toEqual({ allowed: true, remaining: 0 });

    // Request #11 should be denied
    const denied = await checkUserRateLimit('user8', 'boundary', 10, 30_000);
    expect(denied).toEqual({ allowed: false, remaining: 0 });
  });
});

describe('checkRateLimit edge cases', () => {
  it('request #300 is allowed with remaining 0, request #301 is denied', async () => {
    for (let i = 0; i < 299; i++) {
      await checkRateLimit('10.0.0.100');
    }
    // Request #300 should be allowed with remaining: 0
    const last = await checkRateLimit('10.0.0.100');
    expect(last).toEqual({ allowed: true, remaining: 0 });

    // Request #301 should be denied
    const denied = await checkRateLimit('10.0.0.100');
    expect(denied).toEqual({ allowed: false, remaining: 0 });
  });

  it('empty IP string does not crash', async () => {
    const result = await checkRateLimit('');
    expect(result).toEqual({ allowed: true, remaining: 299 });
  });
});

// The shared store is what makes the limit mean anything on serverless, where the
// in-memory map is per-isolate. These load the module with the env set so the
// module-level REDIS_URL/REDIS_TOKEN constants pick it up.
describe('shared store', () => {
  const ENV = { UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'tok' };

  async function loadWithRedis(fetchImpl: typeof fetch) {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ENV.UPSTASH_REDIS_REST_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ENV.UPSTASH_REDIS_REST_TOKEN);
    vi.stubGlobal('fetch', fetchImpl);
    vi.resetModules();
    return import('../rate-limit');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('counts against Redis rather than the local map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 7 }, { result: 1 }],
    });
    const mod = await loadWithRedis(fetchMock as unknown as typeof fetch);

    const result = await mod.checkRateLimit('1.2.3.4');

    // 7th request in the window → 300 - 7 remaining, and the local map never saw it.
    expect(result).toEqual({ allowed: true, remaining: 293 });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://redis.test/pipeline');
    expect(JSON.parse(init.body)).toEqual([
      ['INCR', 'rl:ip:1.2.3.4'],
      ['EXPIRE', 'rl:ip:1.2.3.4', '60', 'NX'],
    ]);
  });

  it('denies once the Redis count passes the limit', async () => {
    const mod = await loadWithRedis(vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 301 }, { result: 0 }],
    }) as unknown as typeof fetch);

    expect(await mod.checkRateLimit('1.2.3.4')).toEqual({ allowed: false, remaining: 0 });
  });

  it('falls back to the local counter when Redis is unreachable', async () => {
    const mod = await loadWithRedis(
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch,
    );

    // Fails open: a counter being down must not take the whole feed offline.
    expect(await mod.checkRateLimit('9.9.9.9')).toEqual({ allowed: true, remaining: 299 });
  });

  it('falls back when Redis answers with a non-OK status', async () => {
    const mod = await loadWithRedis(
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch,
    );

    expect(await mod.checkRateLimit('8.8.8.8')).toEqual({ allowed: true, remaining: 299 });
  });

  it('falls back when Redis returns something unparseable', async () => {
    const mod = await loadWithRedis(
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ error: 'WRONGTYPE' }],
      }) as unknown as typeof fetch,
    );

    expect(await mod.checkRateLimit('7.7.7.7')).toEqual({ allowed: true, remaining: 299 });
  });
});
