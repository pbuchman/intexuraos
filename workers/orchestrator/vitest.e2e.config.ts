import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*e2e*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    pool: 'forks',
    maxWorkers: 1,
  },
});
