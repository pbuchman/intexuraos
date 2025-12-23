import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Run tests sequentially to avoid emulator race conditions
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Longer timeout for emulator operations
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/testing/**',
        '**/*.spec.ts',
        '**/index.ts',
        '**/*.d.ts',
        // Exclude type-only files (no runtime code)
        '**/domain/**/models/**',
        '**/domain/**/ports/**',
      ],
      thresholds: {
        lines: 89,
        branches: 85,
        functions: 90,
        statements: 89,
      },
    },
  },
});
