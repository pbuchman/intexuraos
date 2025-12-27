import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Run tests sequentially to avoid race conditions in shared state
    sequence: {
      shuffle: false,
    },
    // Standard timeout for async operations
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

        // Colocated infra adapters - external service wrappers
        // JUSTIFIED: Thin SDK wrappers tested via integration tests through routes
        // Contains Firestore, Notion, Auth0 adapters that delegate to external SDKs
        '**/infra/**',

        // Web app - React frontend
        // JUSTIFIED: Requires E2E testing strategy, out of scope for unit coverage
        'apps/web/**',

        // Common SDK client wrappers
        // JUSTIFIED: notion.ts tested in packages/common/src/__tests__/notion.test.ts
        // The logging fetch wrapper is complex but tested via integration
        '**/notion.ts',
        // JUSTIFIED: Pure singleton getter with no business logic
        '**/firestore.ts',

        // API docs hub - static aggregator service
        // JUSTIFIED: No business logic, just static config and file serving
        'apps/api-docs-hub/**',

        // WhatsApp external API integration
        // JUSTIFIED: sendWhatsAppMessage() wraps external Graph API, tested via integration
        '**/whatsappClient.ts',
        // JUSTIFIED: Class adapters that delegate to infra functions, no logic
        '**/adapters.ts',

        // Workers - Pub/Sub subscription handlers
        // JUSTIFIED: Thin wrappers around Pub/Sub SDK, tested via integration
        // CleanupWorker subscribes to media cleanup events and calls mediaStorage.delete()
        // Core delete logic is tested via route tests that verify cleanup events are published
        '**/workers/**',

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
      ],
      thresholds: {
        lines: 90,
        branches: 81,
        functions: 90,
        statements: 90,
      },
    },
  },
});
