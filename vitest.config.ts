import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // Placeholder values so supabase.ts module-level validation passes
      // during tests. No live Supabase calls are made in unit tests.
      PURVEYORS_SUPABASE_URL: 'https://placeholder.supabase.co',
      PURVEYORS_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
