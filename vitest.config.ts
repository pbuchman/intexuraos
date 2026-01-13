import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Redirect @notionhq/client to our mock for all packages in the workspace
      '@notionhq/client': path.resolve(__dirname, './vitest-mocks/notion-client.ts'),
    },
  },
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

        // Pure type/interface files with no runtime code
        // JUSTIFIED: TypeScript interfaces only, no executable code
        'packages/infra-*/src/types.ts',
        'packages/llm-*/src/types.ts',
        'packages/llm-contract/src/pricing.ts',

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

        // Route barrel files (re-exports only)
        // JUSTIFIED: Pure re-exports with no runtime behavior
        '**/routes/routes.ts',
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
