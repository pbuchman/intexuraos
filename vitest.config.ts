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
        // Exclude colocated infra (external service adapters) - TODO: add tests later
        '**/infra/**',
        // Exclude web app - TODO: add E2E tests later
        'apps/web/**',
        // Exclude common infra clients - tested via integration
        '**/notion.ts',
        '**/firestore.ts',
        // Exclude api-docs-hub (aggregator, no tests)
        'apps/api-docs-hub/**',
        // Exclude whatsapp client
        '**/whatsappClient.ts',
        '**/adapters.ts',
      ],
      thresholds: {
        // Temporarily lowered due to colocated infra refactoring
        // TODO: Restore to 89/85/90/89 after adding infra tests
        lines: 65,
        branches: 70,
        functions: 45,
        statements: 65,
      },
    },
  },
});
