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
        // Test files (no coverage for tests themselves)
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/testing/**',

        // Index/barrel files (re-exports only, no logic)
        '**/index.ts',

        // Type definition files
        '**/*.d.ts',

        // Type-only files with no runtime code (JUSTIFIED)
        '**/domain/**/models/**',
        '**/domain/**/ports/**',

        // Colocated infra adapters - external service wrappers
        // JUSTIFIED: Tested via integration tests through routes, thin SDK wrappers
        '**/infra/**',

        // Web app - React frontend needs E2E tests (out of scope for unit coverage)
        // JUSTIFIED: Different testing strategy needed
        'apps/web/**',

        // Common SDK client wrappers - thin wrappers around external SDKs
        // JUSTIFIED: Tested via packages/common notion.test.ts
        '**/notion.ts',
        // JUSTIFIED: Pure singleton getter, no logic to test
        '**/firestore.ts',

        // API docs hub - static aggregator service with minimal logic
        // JUSTIFIED: No business logic, just config and static serving
        'apps/api-docs-hub/**',

        // WhatsApp SDK wrapper - external SDK integration
        // JUSTIFIED: Thin SDK wrapper, tested via integration
        '**/whatsappClient.ts',
        '**/adapters.ts',
      ],
      thresholds: {
        // Updated after coverage improvement work (Dec 2024)
        // Infra adapters excluded as they are thin SDK wrappers tested via integration
        lines: 80,
        branches: 72,
        functions: 65,
        statements: 80,
      },
    },
  },
});
