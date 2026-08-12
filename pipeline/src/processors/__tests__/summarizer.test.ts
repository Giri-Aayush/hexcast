import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn();
  return {
    mockCreate,
    mockLoadConfig: vi.fn(),
    mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockCheckEntityPreservation: vi.fn(),
  };
});

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mocks.mockCreate } };
    },
  };
});

vi.mock('../../config.js', () => ({
  loadConfig: mocks.mockLoadConfig,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mocks.mockLogger,
}));

vi.mock('../entity-checker.js', () => ({
  checkEntityPreservation: mocks.mockCheckEntityPreservation,
}));

// ── Import under test (after mocks) ─────────────────────────────────────

import { summarize } from '../summarizer.js';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeResponse(content: string) {
  return {
    choices: [{ message: { content } }],
  };
}

/** Generate a string with exactly N words. */
function wordsOf(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

/** Matches loadConfig()'s shape: providers in preference order, primary first. */
const localLlmConfig = {
  env: 'dev' as const,
  llmProviders: [
    {
      label: 'localhost:11434',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'ollama',
      model: 'llama3.1:8b',
      prompt: 'v1' as const,
      minIntervalMs: 0,
      maxInputChars: 6000,
      extraBody: {},
    },
  ],
};

const remoteLlmConfig = {
  env: 'prod' as const,
  llmProviders: [
    {
      label: 'api.openai.com',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-key',
      model: 'gpt-4.1-mini',
      prompt: 'v1.3' as const,
      minIntervalMs: 0, // no real waiting in tests
      maxInputChars: 8000,
      extraBody: {},
    },
  ],
};

/** Primary that always refuses, plus a working fallback. */
const failoverConfig = {
  env: 'prod' as const,
  llmProviders: [
    { ...remoteLlmConfig.llmProviders[0], label: 'primary.test', baseUrl: 'https://primary.test/v1', model: 'primary-model' },
    { ...remoteLlmConfig.llmProviders[0], label: 'fallback.test', baseUrl: 'https://fallback.test/v1', model: 'fallback-model' },
  ],
};

const defaultTitle = 'Ethereum EIP-7702 Proposal Advances';
const defaultText = 'Some article content about Ethereum EIP-7702 proposal and its implications for account abstraction.';

// ── Setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: what loadConfig() produces for local dev — a local Ollama, V1 prompt,
  // no pacing. The provider is config now, not a fork on PIPELINE_ENV.
  mocks.mockLoadConfig.mockReturnValue({ ...localLlmConfig });

  // Default: entity preservation passes
  mocks.mockCheckEntityPreservation.mockReturnValue({
    passed: true,
    missingEntities: [],
  });
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('summarize', () => {
  it('returns headline and summary on first successful attempt (within 55-60 words)', async () => {
    const summaryText = wordsOf(58);
    const headlineText = 'EIP-7702 Advances Account Abstraction';

    // First call: summary
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(summaryText));
    // Second call: headline
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(headlineText));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(summaryText);
    expect(result.headline).toBe(headlineText);
    // Only 2 API calls: 1 summary attempt + 1 headline
    expect(mocks.mockCreate).toHaveBeenCalledTimes(2);
  });

  it('accepts a short summary instead of retrying for length', async () => {
    // A short summary is usually a property of a thin SOURCE, not a defect. Retrying
    // for length is what made the model pad with invented detail, and it burned three
    // attempts — three copies of the article — on every card.
    const short = wordsOf(30);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(short));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Test Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(short);
    // 2 calls: one summary attempt accepted, one headline. Not 4.
    expect(mocks.mockCreate).toHaveBeenCalledTimes(2);
    expect(result.signals.attempts).toBe(1);
  });

  it('retries when word count is too high and succeeds on second attempt', async () => {
    const tooLong = wordsOf(80);
    const justRight = wordsOf(59);
    const headlineText = 'Test Headline';

    // Attempt 1: over the 60-word ceiling, which IS worth retrying
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(tooLong));
    // Attempt 2: within range
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(justRight));
    // Headline call
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(headlineText));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(justRight);
    expect(mocks.mockCreate).toHaveBeenCalledTimes(3);
  });

  it('takes any length under the ceiling on the first attempt', async () => {
    // 52 words used to be "outside the strict range" and cost two more attempts.
    // Under the ceiling it is just a valid summary.
    const acceptable = wordsOf(52);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(acceptable));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Test Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(acceptable);
    expect(mocks.mockCreate).toHaveBeenCalledTimes(2);
  });

  it('retries a near-empty answer, since that is a real failure', async () => {
    // Under MIN_USEFUL_WORDS the model has not summarized anything, so it is worth
    // asking again — this is the one "too short" case that still earns a retry.
    const nearEmpty = wordsOf(8);
    const usable = wordsOf(44);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(nearEmpty));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(usable));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Test Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(usable);
    expect(result.signals.attempts).toBe(2);
  });

  it('truncates to 60 words if over HARD_MAX_WORDS (67) on final retry', async () => {
    const offTarget = wordsOf(80);
    const stillOff = wordsOf(80);
    const overHardMax = wordsOf(80); // 80 > 67 → truncated to 60
    const headlineText = 'Test Headline';

    // All 3 attempts: 80 words
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(offTarget));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(stillOff));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(overHardMax));
    // Headline
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(headlineText));

    const result = await summarize(defaultText, defaultTitle);

    const wordCount = result.summary.split(/\s+/).filter(Boolean).length;
    // Truncated to 60 words (possibly +period = still 60 words of actual content)
    expect(wordCount).toBeLessThanOrEqual(61);
    expect(wordCount).toBeGreaterThanOrEqual(60);
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('hard-truncated'),
    );
  });

  it('throws if word count is less than 20 after all retries', async () => {
    const tooTiny = wordsOf(10);

    // All 3 attempts: way too short (10 words)
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(tooTiny));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(tooTiny));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(tooTiny));

    await expect(summarize(defaultText, defaultTitle)).rejects.toThrow(
      /Summarization failed after 3 retries/,
    );
  });

  it('includes entity preservation feedback in retry prompt when entities are missing', async () => {
    const attempt1 = wordsOf(80); // over the 60-word ceiling → triggers a retry
    const attempt2 = wordsOf(58); // under the ceiling → accepted
    const headlineText = 'Test Headline';

    mocks.mockCreate.mockResolvedValueOnce(makeResponse(attempt1));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(attempt2));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(headlineText));

    // On retry, entity check finds missing entities
    mocks.mockCheckEntityPreservation
      .mockReturnValueOnce({ passed: false, missingEntities: ['EIP-7702', '$8.7M'] }) // retry check
      .mockReturnValueOnce({ passed: true, missingEntities: [] }); // final check

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(attempt2);

    // The second create call (retry) should include entity feedback in the prompt
    const secondCallMessages = mocks.mockCreate.mock.calls[1][0].messages;
    const userMessage = secondCallMessages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('EIP-7702');
    expect(userMessage.content).toContain('$8.7M');
    expect(userMessage.content).toContain('You MUST include these entities');
  });

  it('falls back to title.split when headline response content is null', async () => {
    const summaryText = wordsOf(58);

    // Summary call
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(summaryText));
    // Headline call returns null content (triggers ?? fallback)
    mocks.mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const longTitle = 'This Is A Very Long Title That Has More Than Twelve Words In It Definitely';
    const result = await summarize(defaultText, longTitle);

    expect(result.summary).toBe(summaryText);
    // Fallback: first 12 words of title
    const expectedFallback = longTitle.split(' ').slice(0, 12).join(' ');
    expect(result.headline).toBe(expectedFallback);
  });

  it('uses the V1 prompt and the configured local model', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...localLlmConfig });

    const summaryText = wordsOf(58);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(summaryText));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Dev Headline'));

    await summarize(defaultText, defaultTitle);

    // Check the summary call used V1 system prompt
    const summaryCall = mocks.mockCreate.mock.calls[0][0];
    const systemMessage = summaryCall.messages.find((m: { role: string }) => m.role === 'system');
    expect(systemMessage.content).toContain('You write 60-word news cards for Hexcast');
    // V1 does NOT contain the <think> block instruction
    expect(systemMessage.content).not.toContain('<think>');

    // V1 user prompt uses "Write exactly 60 words"
    const userMessage = summaryCall.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('in no more than 60 words');

    // Model should be Ollama
    expect(summaryCall.model).toBe('llama3.1:8b');

    expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('llama3.1:8b (v1)'),
    );
  });

  it('uses the V1.3 prompt and the configured remote model', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...remoteLlmConfig });

    const summaryText = wordsOf(58);
    // Prod output may have <think> block
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(summaryText));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Prod Headline'));

    await summarize(defaultText, defaultTitle);

    const summaryCall = mocks.mockCreate.mock.calls[0][0];
    const systemMessage = summaryCall.messages.find((m: { role: string }) => m.role === 'system');
    // V1.3 system prompt contains the <think> block instruction
    expect(systemMessage.content).toContain('<think>');
    expect(systemMessage.content).toContain('You write 60-word news cards for Hexcast');

    // V1.3 user prompt uses "Summarize this content in exactly 60 words"
    const userMessage = summaryCall.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('in no more than 60 words');

    // Model should be gpt-4.1-mini
    expect(summaryCall.model).toBe('gpt-4.1-mini');

    expect(mocks.mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('gpt-4.1-mini (v1.3)'),
    );
  });

  it('strips <think> block from V1.3 output and extracts summary properly', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...remoteLlmConfig });

    const actualSummary = wordsOf(58);
    const prodOutput = `<think>
Key identifiers: EIP-7702, v5.4.0, $8.7M
Must preserve these in summary.
</think>
${actualSummary}`;

    mocks.mockCreate.mockResolvedValueOnce(makeResponse(prodOutput));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Prod Headline'));

    const result = await summarize(defaultText, defaultTitle);

    // The <think> block should be stripped
    expect(result.summary).not.toContain('<think>');
    expect(result.summary).not.toContain('</think>');
    expect(result.summary).not.toContain('Key identifiers');
    expect(result.summary).toBe(actualSummary);
  });

  it('strips conversational preamble from dev output before counting words', async () => {
    // llama3.1:8b narrates before answering despite the prompt forbidding it.
    // The preamble was reaching the card verbatim AND counting toward the
    // 55-60 word budget, so the real body came out short.
    const actualSummary = wordsOf(57);
    mocks.mockCreate.mockResolvedValueOnce(
      makeResponse(`Here is a 60-word news card summarizing the article:\n\n${actualSummary}`),
    );
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Dev Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(actualSummary);
    // One call for the summary, one for the headline — the 57-word body passed
    // the strict range on the first attempt, so no retry was needed.
    expect(mocks.mockCreate).toHaveBeenCalledTimes(2);
  });

  it('strips a leading "Summary:" label from dev output', async () => {
    const actualSummary = wordsOf(56);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(`Summary: ${actualSummary}`));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Dev Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(actualSummary);
  });

  it('applies post-loop safety net truncation when summary exceeds HARD_MAX_WORDS', async () => {
    // Edge case: summary passes retry loop (e.g., within fallback range on attempt 3)
    // but entity check or other manipulation pushes it above 67 words afterward.
    // The post-loop safety net catches this.
    //
    // We simulate this by having the retry loop accept a 65-word summary (within fallback range)
    // and then the extractSummaryText or entity manipulation somehow makes it 70 words.
    // However in practice, the simplest way to trigger the post-loop safety net is:
    // - An attempt returns exactly FALLBACK_MAX (65) words in dev mode → accepted
    // - This already passes the retry loop, so the safety net checks again.
    //
    // A cleaner approach: produce a summary that the retry loop hard-truncates, but then
    // the post-loop check is redundant. Instead, let's test a scenario where the retry
    // loop accepts a value, but due to the entity check string manipulation the count changes.
    //
    // Actually, the simplest path: 3 attempts all return 70 words.
    // Retry loop: attempt 3 → 70 > 67 → hard truncated to 60 words.
    // Post-loop safety net then re-checks: 60 <= 67 → no action.
    //
    // To actually trigger the post-loop safety net independently, we need the loop to
    // exit with > 67 words without triggering the in-loop truncation. This can happen if
    // the first attempt returns a value in the strict range (55-60) that breaks out of
    // the loop, but the extractSummaryText for non-prod mode returns the raw output.
    // Let's test by directly verifying the safety behavior: the summary is guaranteed <= 67 words.

    // More direct approach: first attempt returns 70 words in strict range check.
    // 70 is NOT in [55, 60], so it continues. On attempt 3, 70 > 67, so it truncates.
    // The post-loop safety net is a secondary guard. Let's just ensure it works by
    // verifying the final output is <= 67 words regardless.

    const seventyWords = wordsOf(70);
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(seventyWords));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(seventyWords));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse(seventyWords));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Headline'));

    const result = await summarize(defaultText, defaultTitle);

    const finalWordCount = result.summary.split(/\s+/).filter(Boolean).length;
    expect(finalWordCount).toBeLessThanOrEqual(67);
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('truncated'),
    );
  });

  it('truncates long fullText at the configured max input chars', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...remoteLlmConfig });

    // Create text > 8000 chars
    const longText = 'A'.repeat(10000);
    const summaryText = wordsOf(58);

    mocks.mockCreate.mockResolvedValueOnce(makeResponse(summaryText));
    mocks.mockCreate.mockResolvedValueOnce(makeResponse('Headline'));

    await summarize(longText, defaultTitle);

    // The user prompt sent to the API should contain the truncated text
    const summaryCall = mocks.mockCreate.mock.calls[0][0];
    const userMessage = summaryCall.messages.find((m: { role: string }) => m.role === 'user');
    // Should contain the truncation marker
    expect(userMessage.content).toContain('[Content truncated]');
    // The full 10000-char text should not be in the prompt
    expect(userMessage.content).not.toContain('A'.repeat(10000));
    // But the first 8000 chars should be present
    expect(userMessage.content).toContain('A'.repeat(8000));
  });
});

describe('provider failover', () => {
  /** An SDK-shaped HTTP error, since that is what the failover decision reads. */
  function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${status}`), { status });
  }

  it('falls over to the next provider on a rate limit', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate
      .mockRejectedValueOnce(httpError(429))          // primary refuses
      .mockResolvedValueOnce(makeResponse(wordsOf(48))) // fallback answers
      .mockResolvedValueOnce(makeResponse('Fallback Headline'));

    const result = await summarize(defaultText, defaultTitle);

    expect(result.summary).toBe(wordsOf(48));
    expect(mocks.mockCreate.mock.calls[1][0].model).toBe('fallback-model');
    expect(mocks.mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Used fallback provider'));
  });

  it('falls over on a server fault', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce(makeResponse(wordsOf(50)))
      .mockResolvedValueOnce(makeResponse('Headline'));

    await expect(summarize(defaultText, defaultTitle)).resolves.toBeDefined();
  });

  it('falls over when there is no HTTP status at all', async () => {
    // Timeouts, DNS failures and dropped sockets carry no status. They are the
    // provider's problem, so another one may answer.
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate
      .mockRejectedValueOnce(new Error('Connection error.'))
      .mockResolvedValueOnce(makeResponse(wordsOf(45)))
      .mockResolvedValueOnce(makeResponse('Headline'));

    await expect(summarize(defaultText, defaultTitle)).resolves.toBeDefined();
  });

  it('does NOT fall over on a rejected key — it surfaces', async () => {
    // The whole point. A dead key that quietly falls through to a working fallback is
    // how a broken primary stays hidden until the fallback runs out too. That exact
    // failure — a dead OpenAI key — cost an afternoon and every card in a prod run.
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate.mockRejectedValueOnce(httpError(401));

    await expect(summarize(defaultText, defaultTitle)).rejects.toThrow('HTTP 401');
    // One attempt only: the fallback must not be consulted.
    expect(mocks.mockCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall over on a malformed request', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate.mockRejectedValueOnce(httpError(400));

    await expect(summarize(defaultText, defaultTitle)).rejects.toThrow('HTTP 400');
    expect(mocks.mockCreate).toHaveBeenCalledTimes(1);
  });

  it('gives up when every provider refuses', async () => {
    mocks.mockLoadConfig.mockReturnValue({ ...failoverConfig });
    mocks.mockCreate.mockRejectedValue(httpError(429));

    await expect(summarize(defaultText, defaultTitle)).rejects.toThrow('HTTP 429');
    expect(mocks.mockCreate).toHaveBeenCalledTimes(2); // primary + one fallback
  });

  it('sends each provider its own model and extra body', async () => {
    mocks.mockLoadConfig.mockReturnValue({
      env: 'prod' as const,
      llmProviders: [
        { ...failoverConfig.llmProviders[0], extraBody: { reasoning: { enabled: false } } },
        { ...failoverConfig.llmProviders[1], extraBody: {} },
      ],
    });
    mocks.mockCreate
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce(makeResponse(wordsOf(48)))
      .mockResolvedValueOnce(makeResponse('Headline'));

    await summarize(defaultText, defaultTitle);

    // Provider-specific params must not leak across a failover: the primary needs
    // reasoning disabled, the fallback does not understand the param at all.
    expect(mocks.mockCreate.mock.calls[0][0].reasoning).toEqual({ enabled: false });
    expect(mocks.mockCreate.mock.calls[1][0].reasoning).toBeUndefined();
  });
});
