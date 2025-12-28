import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Setup file to mock Firebase and suppress logging
    setupFiles: ['./vitest.setup.ts'],
    // Run tests sequentially to avoid race conditions in shared state
    sequence: {
      shuffle: false,
    },
    // Standard timeout for async operations
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      include: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
      exclude: [
        // Test files (no coverage for tests themselves)
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/testing/**',
        '**/__tests__/**',

        // Index/barrel files (re-exports only, no logic)
        // JUSTIFIED: Pure re-exports with no runtime behavior
        '**/index.ts',

        // Type definition files
        '**/*.d.ts',

        // Type-only files with no runtime code
        // JUSTIFIED: Interfaces and types only, no executable code
        '**/domain/**/models/**',
        '**/domain/**/ports/**',
        '**/domain/**/events/**',

        // Web app - React frontend
        // JUSTIFIED: Requires E2E testing strategy, out of scope for unit coverage
        'apps/web/**',

        // JUSTIFIED: Pure singleton getter with no business logic
        '**/firestore.ts',

        // API docs hub - static aggregator service
        // JUSTIFIED: No business logic, just static config and file serving
        'apps/api-docs-hub/**',

        // JUSTIFIED: Class adapters that delegate to infra functions, no logic
        '**/adapters.ts',

        // Server initialization files
        // JUSTIFIED: Contains Fastify app setup, plugin registration, and lifecycle hooks
        // These are infrastructure setup, not business logic. Tested implicitly via route tests.
        '**/server.ts',

        // Service container/singleton files
        // JUSTIFIED: Dependency injection containers with singleton getters
        // No business logic, just service instantiation and caching
        '**/services.ts',

        // HTTP logger utility
        // JUSTIFIED: Logging wrapper with no business logic, tested implicitly via route tests
        '**/http/logger.ts',

        // Route barrel files (re-exports only)
        // JUSTIFIED: Pure re-exports with no runtime behavior
        '**/routes/routes.ts',

        // BLOCKED: vi.mock ESM hoisting fails for external SDK class constructors
        // These require refactoring to dependency injection to test
        '**/infra/speechmatics/adapter.ts',
        '**/infra/gcs/mediaStorageAdapter.ts',

        // BLOCKED: Pub/Sub subscription handler requiring subscription.on() mocking
        '**/workers/cleanupWorker.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 90,
        statements: 90,
      },
    },
  },
});
