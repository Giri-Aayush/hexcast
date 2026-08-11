function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export type PipelineEnv = 'dev' | 'prod';

export function loadConfig() {
  const env = (process.env.PIPELINE_ENV ?? 'dev') as PipelineEnv;

  // In prod, OPENAI_API_KEY is required for GPT-4.1 Mini summarization
  if (env === 'prod' && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when PIPELINE_ENV=prod');
  }

  return {
    env,
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceKey: requireEnv('SUPABASE_SERVICE_KEY'),
    githubPat: process.env.GITHUB_PAT ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    groqApiKey: process.env.GROQ_API_KEY ?? '',
    cryptoPanicApiKey: process.env.CRYPTOPANIC_API_KEY ?? '',
    pipelineVersion: process.env.PIPELINE_VERSION ?? '0.1.0',
    logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
    dryRun: process.env.DRY_RUN === 'true',
    // Batch processing: how many items to process per pipeline run
    batchSize: parseInt(process.env.BATCH_SIZE ?? '200', 10),
    // Concurrent AI summarizations — dev=1 (Ollama), prod=10 (OpenAI)
    concurrency: parseInt(process.env.CONCURRENCY ?? (env === 'prod' ? '10' : '1'), 10),
    // Dev summarization runs against a local Ollama. Overridable so a machine
    // that already has a different model pulled doesn't need the 4.9 GB default.
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
    ollamaModel: process.env.OLLAMA_MODEL ?? 'llama3.1:8b',
  };
}

export type Config = ReturnType<typeof loadConfig>;
