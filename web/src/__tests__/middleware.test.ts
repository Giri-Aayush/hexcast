import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockCheckRateLimit } = vi.hoisted(() => {
  const mockCheckRateLimit = vi.fn();
  return { mockCheckRateLimit };
});

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (callback: any) => {
    return (request: any, _event: any) => callback({}, request);
  },
}));

import middleware, { config } from '../middleware';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('middleware', () => {
  describe('non-API routes', () => {
    it('returns undefined for non-API routes (no rate limiting applied)', async () => {
      const request = new NextRequest('http://localhost/about');
      const result = await middleware(request as any, {} as any);
      expect(result).toBeUndefined();
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('returns undefined for the root path', async () => {
      const request = new NextRequest('http://localhost/');
      const result = await middleware(request as any, {} as any);
      expect(result).toBeUndefined();
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    it('returns undefined for nested non-API paths', async () => {
      const request = new NextRequest('http://localhost/dashboard/settings');
      const result = await middleware(request as any, {} as any);
      expect(result).toBeUndefined();
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('API routes - allowed requests', () => {
    it('returns a response with X-RateLimit-Remaining header when allowed', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 299 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });

      const result = (await middleware(request as any, {} as any)) as Response;

      expect(result).toBeDefined();
      expect(result.status).toBe(200);
      expect(result.headers.get('X-RateLimit-Remaining')).toBe('299');
      expect(mockCheckRateLimit).toHaveBeenCalledWith('1.2.3.4');
    });

    it('sets correct remaining count as requests are consumed', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 42 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });

      const result = (await middleware(request as any, {} as any)) as Response;

      expect(result.headers.get('X-RateLimit-Remaining')).toBe('42');
    });

    it('sets remaining to 0 on the last allowed request', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 0 });
      const request = new NextRequest('http://localhost/api/reactions', {
        headers: { 'x-forwarded-for': '10.0.0.2' },
      });

      const result = (await middleware(request as any, {} as any)) as Response;

      expect(result.status).toBe(200);
      expect(result.headers.get('X-RateLimit-Remaining')).toBe('0');
    });
  });

  describe('API routes - denied requests', () => {
    it('returns 429 with Retry-After header when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });

      const result = (await middleware(request as any, {} as any)) as Response;

      expect(result).toBeDefined();
      expect(result.status).toBe(429);
      expect(result.headers.get('Retry-After')).toBe('60');

      const body = await result.json();
      expect(body).toEqual({ error: 'Too many requests' });
    });

    it('returns 429 for any API sub-path when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
      const request = new NextRequest('http://localhost/api/feedback', {
        headers: { 'x-forwarded-for': '5.6.7.8' },
      });

      const result = (await middleware(request as any, {} as any)) as Response;

      expect(result.status).toBe(429);
      const body = await result.json();
      expect(body).toEqual({ error: 'Too many requests' });
    });
  });

  describe('IP extraction from x-forwarded-for', () => {
    it('extracts the first IP from a comma-separated list', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 299 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' },
      });

      await middleware(request as any, {} as any);

      expect(mockCheckRateLimit).toHaveBeenCalledWith('1.2.3.4');
    });

    it('trims whitespace from the extracted IP', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 299 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' },
      });

      await middleware(request as any, {} as any);

      expect(mockCheckRateLimit).toHaveBeenCalledWith('1.2.3.4');
    });

    it('falls back to "unknown" when x-forwarded-for header is missing', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 299 });
      const request = new NextRequest('http://localhost/api/cards');

      await middleware(request as any, {} as any);

      expect(mockCheckRateLimit).toHaveBeenCalledWith('unknown');
    });

    it('uses a single IP directly when no commas present', async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 299 });
      const request = new NextRequest('http://localhost/api/cards', {
        headers: { 'x-forwarded-for': '192.168.1.100' },
      });

      await middleware(request as any, {} as any);

      expect(mockCheckRateLimit).toHaveBeenCalledWith('192.168.1.100');
    });
  });

  describe('config', () => {
    it('exports a matcher configuration', async () => {
      expect(config).toBeDefined();
      expect(config.matcher).toBeInstanceOf(Array);
      expect(config.matcher.length).toBeGreaterThan(0);
    });

    it('includes patterns for API and trpc routes', async () => {
      const matchers = config.matcher.join(' ');
      expect(matchers).toContain('api');
      expect(matchers).toContain('trpc');
    });
  });
});
