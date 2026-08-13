import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyImageError, generateCardImage, generateAndStore } from '../image-generator.js';

vi.mock('../../utils/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

describe('classifyImageError', () => {
  it('treats rate limits and server faults as transient', () => {
    expect(classifyImageError(429, 'rate limited')).toBe('transient');
    expect(classifyImageError(500, 'internal error')).toBe('transient');
    expect(classifyImageError(503, 'unavailable')).toBe('transient');
  });

  it('treats a missing status as transient', () => {
    // Timeout, DNS, socket reset. The network failed, not the request.
    expect(classifyImageError(undefined, '')).toBe('transient');
  });

  it('separates a content refusal from a bad request', () => {
    // Different classes because the fix differs: a refusal means change the prompt, a 400
    // means fix the code. Retrying a refusal unchanged pays again for the same answer.
    expect(classifyImageError(400, 'blocked by content policy')).toBe('refused');
    expect(classifyImageError(400, 'invalid model parameter')).toBe('invalid');
    expect(classifyImageError(404, 'no such model')).toBe('invalid');
    expect(classifyImageError(401, 'bad key')).toBe('invalid');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyImageError(418, 'teapot')).toBe('unknown');
  });
});

describe('generateCardImage', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const respondWith = (body: unknown, ok = true, status = 200) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;
  };

  it('classifies a text-only answer as a refusal', () => {
    // A model that declines answers with prose and a 200. Treating that as success would
    // store a zero-byte object and mark the card done.
    respondWith({ choices: [{ message: { content: "I can't create that image." } }] });

    return generateCardImage('SECURITY', ['fracture'], { apiKey: 'k' }).then((result) => {
      expect(result.png).toBeUndefined();
      expect(result.error).toBe('refused');
      expect(result.detail).toContain("can't create");
    });
  });

  it('rejects an implausibly small payload instead of storing it', async () => {
    respondWith({ data: [{ b64_json: 'AAAA', media_type: 'image/png' }] });

    const result = await generateCardImage('SECURITY', [], { apiKey: 'k' });

    expect(result.png).toBeUndefined();
    expect(result.detail).toContain('implausibly small');
  });

  it('surfaces the provider status as an error class', async () => {
    respondWith({ error: 'slow down' }, false, 429);

    const result = await generateCardImage('UPGRADE', [], { apiKey: 'k' });

    expect(result.error).toBe('transient');
  });

  it('never throws when the network fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

    const result = await generateCardImage('UPGRADE', [], { apiKey: 'k' });

    expect(result.error).toBe('transient');
    expect(result.detail).toContain('ECONNRESET');
  });

  it('never sends the summary to the image model', async () => {
    // The structural guarantee: an event the model never sees is an event it cannot depict.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'no' } }] }),
      text: async () => '',
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateCardImage('SECURITY', ['fracture'], { apiKey: 'k' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const prompt = body.prompt as string;
    expect(prompt).toContain('fracture');
    expect(prompt).toContain('No text, no letters');
    // No seed: the parameter is accepted and ignored, so sending one would advertise a
    // determinism this path does not have.
    expect(body).not.toHaveProperty('seed');
  });
});

describe('generateAndStore', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => 'rate limited',
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns an error class and never uploads when generation fails', async () => {
    const upload = vi.fn();

    const result = await generateAndStore('card-1', 'SECURITY', [], { apiKey: 'k', upload });

    expect(result).toEqual({ error: 'transient' });
    expect(upload).not.toHaveBeenCalled();
  });
});
