function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type PipelineEnv = 'dev' | 'prod';

export type PromptVersion = 'v1' | 'v1.3';

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
    // Extra JSON merged into every completions request, for params only one provider
    // understands — OpenRouter's reasoning:{exclude:true} being the case in hand, since
    // reasoning tokens bill as output and a 60-word factual summary needs none of it.
    // Kept as opaque passthrough so a provider quirk never becomes a code change.
    llmExtraBody: parseJson(process.env.LLM_EXTRA_BODY),
  };
}

export type Config = ReturnType<typeof loadConfig>;
