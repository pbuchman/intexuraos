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
        // TODO(2-0): Add tests for infra adapters
        '**/infra/**',

        // Web app - React frontend needs E2E tests (out of scope for unit coverage)
        // JUSTIFIED: Different testing strategy needed
        'apps/web/**',

        // Common SDK client wrappers - thin wrappers around external SDKs
        // TODO(0-1): Add unit tests for mapNotionError and createNotionClient
        '**/notion.ts',
        // JUSTIFIED: Pure singleton getter, no logic to test
        '**/firestore.ts',

        // API docs hub - static aggregator service with minimal logic
        // JUSTIFIED: No business logic, just config and static serving
        'apps/api-docs-hub/**',

        // WhatsApp SDK wrapper - external SDK integration
        // TODO(2-0): Add tests as part of infra coverage
        '**/whatsappClient.ts',
        '**/adapters.ts',
      ],
      thresholds: {
        // Current: 65/70/45/65, Target: 89/85/90/89
        // See docs/todo/README.md for coverage improvement plan
        lines: 65,
        branches: 70,
        functions: 45,
        statements: 65,
      },
    },
  },
});
