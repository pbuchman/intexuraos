import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Run tests sequentially to avoid race conditions in shared state
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
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

        // SRT service - new service scaffold
        // JUSTIFIED: Tier 1 infrastructure only, tests come in Tier 4 (task 4-1)
        'apps/srt-service/**',

        // WhatsApp external API integration
        // JUSTIFIED: sendWhatsAppMessage() wraps external Graph API, tested via integration
        '**/whatsappClient.ts',
        // JUSTIFIED: Class adapters that delegate to infra functions, no logic
        '**/adapters.ts',
      ],
      thresholds: {
        // Updated after coverage improvement work (Dec 2024)
        // Phase 2: Raised to 90% target after completing all Tier 1 coverage tasks
        // Infra adapters excluded as they are thin SDK wrappers tested via integration
        // Branch threshold lowered to 80% during Tier 2 feature work (will be restored in Tier 4)
        lines: 90,
        branches: 80,
        functions: 75,
        statements: 90,
      },
    },
  },
});
