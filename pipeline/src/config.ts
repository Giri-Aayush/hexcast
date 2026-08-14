function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type PipelineEnv = 'dev' | 'prod';

export type PromptVersion = 'v1' | 'v1.3';

export interface LlmProvider {
  /** Shown in logs when a call fails over, so the reason is legible. */
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: PromptVersion;
  minIntervalMs: number;
  maxInputChars: number;
  extraBody: Record<string, unknown>;
}

/**
 * Read LLM_FALLBACK_* (and _2_, _3_ if anyone adds them) into the chain behind the
 * primary. A fallback is only added when it has a base URL; declaring one without a key
 * throws rather than being skipped, because a silently-dropped fallback looks identical
 * to a working one right up to the outage it was meant to cover.
 */
function buildProviders(opts: { env: PipelineEnv; primary: Omit<LlmProvider, 'label'> }): LlmProvider[] {
  const providers: LlmProvider[] = [{ label: hostOf(opts.primary.baseUrl), ...opts.primary }];

  for (const slot of ['', '_2', '_3']) {
    const baseUrl = process.env[`LLM_FALLBACK${slot}_BASE_URL`];
    if (!baseUrl) continue;

    const apiKey = process.env[`LLM_FALLBACK${slot}_API_KEY`] ?? '';
    if (!apiKey) {
      throw new Error(`LLM_FALLBACK${slot}_BASE_URL is set but LLM_FALLBACK${slot}_API_KEY is empty`);
    }

    const model = process.env[`LLM_FALLBACK${slot}_MODEL`];
    if (!model) {
      throw new Error(`LLM_FALLBACK${slot}_BASE_URL is set but LLM_FALLBACK${slot}_MODEL is empty`);
    }

    providers.push({
      label: hostOf(baseUrl),
      baseUrl,
      apiKey,
      model,
      // Prompt and input cap inherit from the primary unless overridden — the fallback is
      // usually the same model class, and PROMPT.md's lesson is that a DIFFERENT model
      // deserves a measured prompt rather than an assumed one.
      prompt: (process.env[`LLM_FALLBACK${slot}_PROMPT`] as PromptVersion | undefined) ?? opts.primary.prompt,
      minIntervalMs: parseInt(
        process.env[`LLM_FALLBACK${slot}_MIN_INTERVAL_MS`] ?? String(opts.primary.minIntervalMs),
        10,
      ),
      maxInputChars: opts.primary.maxInputChars,
      extraBody: parseJson(process.env[`LLM_FALLBACK${slot}_EXTRA_BODY`]),
    });
  }

  return providers;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Malformed JSON here would otherwise fail deep inside the client with no clue why. */
function parseJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM_EXTRA_BODY is not valid JSON: ${raw}`);
  }
}

export function loadConfig() {
  const env = (process.env.PIPELINE_ENV ?? 'dev') as PipelineEnv;

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
  const ollamaModel = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
  const openaiApiKey = process.env.OPENAI_API_KEY ?? '';

  // Summarization used to be a hardcoded fork: prod meant OpenAI, dev meant a local
  // Ollama. Any other OpenAI-compatible endpoint — Groq, NVIDIA NIM, OpenRouter, a
  // self-hosted vLLM — is just a base URL, a key and a model name, so those are now
  // explicit instead of implied by PIPELINE_ENV. Defaults reproduce the old
  // behaviour exactly, so setting nothing changes nothing.
  const llmBaseUrl =
    process.env.LLM_BASE_URL ?? (env === 'prod' ? 'https://api.openai.com/v1' : ollamaBaseUrl);
  const llmApiKey = process.env.LLM_API_KEY ?? (env === 'prod' ? openaiApiKey : 'ollama');
  const llmModel = process.env.LLM_MODEL ?? (env === 'prod' ? 'gpt-4.1-mini' : ollamaModel);

  // Only OPENAI_API_KEY is required, and only when prod is still pointed at OpenAI.
  // Pointing LLM_BASE_URL elsewhere makes an OpenAI key irrelevant, and demanding one
  // would block exactly the migration this exists to allow.
  const usingOpenAI = llmBaseUrl.includes('api.openai.com');
  if (env === 'prod' && usingOpenAI && !openaiApiKey) {
    throw new Error('OPENAI_API_KEY is required when PIPELINE_ENV=prod and LLM_BASE_URL is OpenAI');
  }
  if (env === 'prod' && !usingOpenAI && !llmApiKey) {
    throw new Error('LLM_API_KEY is required when PIPELINE_ENV=prod with a custom LLM_BASE_URL');
  }

  // A localhost endpoint needs no pacing; anything remote does. Explicit so a free
  // tier with a tight per-minute cap can be slowed without touching code.
  const isLocalLlm = /localhost|127\.0\.0\.1/.test(llmBaseUrl);

  return {
    env,
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceKey: requireEnv('SUPABASE_SERVICE_KEY'),
    githubPat: process.env.GITHUB_PAT ?? '',
    openaiApiKey,
    cryptoPanicApiKey: process.env.CRYPTOPANIC_API_KEY ?? '',
    pipelineVersion: process.env.PIPELINE_VERSION ?? '0.1.0',
    logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
    dryRun: process.env.DRY_RUN === 'true',
    // Batch processing: how many items to process per pipeline run
    batchSize: parseInt(process.env.BATCH_SIZE ?? '200', 10),
    // Concurrent AI summarizations — dev=1 (Ollama), prod=10 (OpenAI)
    concurrency: parseInt(process.env.CONCURRENCY ?? (env === 'prod' ? '10' : '1'), 10),
    ollamaBaseUrl,
    ollamaModel,
    llmBaseUrl,
    llmApiKey,
    llmModel,
    // Which PROMPT.md variant to use. V1 benchmarked best on the local 8B, V1.3 on
    // GPT-4.1 Mini; a new model needs measuring rather than assuming.
    llmPrompt: (process.env.LLM_PROMPT ?? (env === 'prod' ? 'v1.3' : 'v1')) as PromptVersion,
    // Minimum gap between LLM calls, ms. 0 local, 150 remote (~400 rpm).
    llmMinIntervalMs: parseInt(process.env.LLM_MIN_INTERVAL_MS ?? (isLocalLlm ? '0' : '150'), 10),
    llmMaxInputChars: parseInt(process.env.LLM_MAX_INPUT_CHARS ?? (isLocalLlm ? '6000' : '8000'), 10),
    // Minimum source text before an item is worth summarizing. Below this the model
    // has to invent to fill a card, and invented facts are worse than no card on a
    // product that promises factual accuracy. 600 chars is roughly 100 words of
    // source, so even a 40-60 word card is a real compression rather than a restatement
    // padded out. Lowering this buys more cards and pays for them in invented detail.
    minSourceChars: parseInt(process.env.MIN_SOURCE_CHARS ?? '600', 10),
    // How old an item may be and still become a card. This is a news feed: 514 of the
    // 2,104 items banked by the cold fetch are over a year old, and getCards() has no age
    // filter, so without this an anonymous visitor sees year-old forum posts as news.
    // 90 rather than 30 days because a six-week-old EIP discussion is still interesting
    // to this audience, just not breaking.
    maxSourceAgeDays: parseInt(process.env.MAX_SOURCE_AGE_DAYS ?? '90', 10),
    // A short source with several hard identifiers is summarizable; a short source with
    // none is not. Character count alone could not tell those apart and was silently
    // excluding an entire category — see the gate in processRawItems.
    minSourceIdentifiers: parseInt(process.env.MIN_SOURCE_IDENTIFIERS ?? '3', 10),
    /**
     * Hard ceiling on cards written per UTC day. Summarization is the only per-card cost that
     * scales with volume, so this is the spend ceiling expressed in the unit that actually
     * drives it. UTC because the cron runs UTC and both card timestamps are timestamptz —
     * picking the runner's local day would move the boundary with the runner.
     */
    maxCardsPerDay: parseInt(process.env.MAX_CARDS_PER_DAY ?? '100', 10),
    /**
     * How recent an item must be to be worth summarizing, in HOURS.
     *
     * maxSourceAgeDays is the archive bound — 90 days, "this is not news any more". This is the
     * INGESTION bound: "we are not paying to summarize this". They are different questions and
     * were previously the same number, which is why a day-old backlog was still eligible.
     *
     * Falls back to maxSourceAgeDays so an environment that only sets the old variable keeps
     * its existing behaviour rather than silently tightening to 24h.
     */
    ingestMaxAgeHours: parseInt(
      process.env.MAX_INGEST_AGE_HOURS ?? String(parseInt(process.env.MAX_SOURCE_AGE_DAYS ?? '90', 10) * 24),
      10,
    ),
    /**
     * Generate a unique cover image per high-priority card, instead of assigning from the
     * reusable category pool. Costs ~$0.015 per card written; the pool costs ~$2 once.
     * Defaults OFF so the expensive path is chosen deliberately rather than inherited.
     */
    perCardImages: process.env.CARD_IMAGES_PER_CARD === 'true',
    // Extra JSON merged into every completions request, for params only one provider
    // understands — OpenRouter's reasoning:{exclude:true} being the case in hand, since
    // reasoning tokens bill as output and a 60-word factual summary needs none of it.
    // Kept as opaque passthrough so a provider quirk never becomes a code change.
    llmExtraBody: parseJson(process.env.LLM_EXTRA_BODY),
    /**
     * Summarization providers in preference order. The first is the primary; the rest
     * are tried only when one refuses in a way worth retrying elsewhere.
     *
     * A list rather than primary+fallback fields because the call path takes a list
     * anyway, so supporting a longer chain later is config, not a rewrite. Today
     * production runs a paid uncapped primary with one no-cap fallback: failover fires
     * on an outage, and only a fallback without a daily wall can carry sustained load.
     */
    llmProviders: buildProviders({
      env,
      primary: {
        baseUrl: llmBaseUrl,
        apiKey: llmApiKey,
        model: llmModel,
        prompt: (process.env.LLM_PROMPT ?? (env === 'prod' ? 'v1.3' : 'v1')) as PromptVersion,
        minIntervalMs: parseInt(process.env.LLM_MIN_INTERVAL_MS ?? (isLocalLlm ? '0' : '150'), 10),
        maxInputChars: parseInt(process.env.LLM_MAX_INPUT_CHARS ?? (isLocalLlm ? '6000' : '8000'), 10),
        extraBody: parseJson(process.env.LLM_EXTRA_BODY),
      },
    }),
  };
}

export type Config = ReturnType<typeof loadConfig>;
