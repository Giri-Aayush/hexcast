import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/__tests__/**'],
    },
    env: {
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_KEY: 'test-service-key',
      PIPELINE_ENV: 'dev',
      LOG_LEVEL: 'error',
      // Unit tests mock every request, so the fetchers' politeness delays buy
      // nothing here and used to push the suite past vitest's 5s cap on a loaded
      // machine. The integration config leaves them at 1 — that one hits real
      // sources and must stay polite.
      FETCH_DELAY_SCALE: '0',
    },
  },
});
