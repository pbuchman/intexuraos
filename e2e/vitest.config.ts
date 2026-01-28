import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: './',
    testTimeout: 120_000, // 2 minutes for E2E tests
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // E2E tests must run sequentially
      },
    },
    environment: 'node',
    setupFiles: [],
    include: ['tests/**/*.spec.ts'],
    exclude: [],
    coverage: {
      provider: 'v8',
      // E2E tests don't need coverage reporting
      // They test integration, not unit-level coverage
    },
  },
});
