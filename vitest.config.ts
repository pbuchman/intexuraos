import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Global setup for Firestore emulator
    globalSetup: ['./packages/infra/firestore/src/testing/vitest.globalSetup.ts'],
    setupFiles: ['./packages/infra/firestore/src/testing/vitest.setup.ts'],
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
      include: ['packages/**/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/testing/**',
        '**/*.spec.ts',
        '**/index.ts',
        '**/*.d.ts',
        // Exclude type-only files (no runtime code)
        '**/domain/identity/**',
        '**/domain/promptvault/src/ports.ts',
        '**/domain/promptvault/src/ports/**',
        '**/domain/promptvault/src/models/Prompt.ts',
        'packages/domain/inbox/src/models/InboxNote.ts',
        'packages/domain/inbox/src/ports/repositories.ts',
        // Exclude testing utilities (emulator, fakes)
        '**/firestore/src/testing/**',
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
