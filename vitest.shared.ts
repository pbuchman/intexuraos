import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = __dirname;

/**
 * Shared vitest base for every workspace. Individual workspace configs extend
 * this via `mergeConfig(sharedConfig, defineConfig({ ... }))`.
 *
 * Workspace-level overrides SHOULD only touch:
 *   - `test.include` / `test.exclude` — workspace-specific test discovery
 *   - `test.coverage.include` — workspace source globs
 *   - workspace-local `resolve.alias` entries
 *
 * Workspace configs MUST NOT redefine `setupFiles` — every workspace inherits
 * the root-level Firebase / Notion / fetch / localStorage mocks defined in
 * `vitest.setup.ts`. The single documented exception is `e2e/vitest.config.ts`,
 * which intentionally opts out (E2E tests target real services).
 */
export const sharedConfig: UserConfig = defineConfig({
  resolve: {
    alias: {
      // Redirect @notionhq/client to our mock for all packages in the workspace
      '@notionhq/client': path.resolve(repoRoot, './vitest-mocks/notion-client.ts'),
      // Web app path alias (used in apps/web/src)
      '@': path.resolve(repoRoot, './apps/web/src'),
    },
  },
  test: {
    globals: false,
    // Setup file to mock Firebase/Notion/fetch and suppress logging.
    // INVARIANT: workspaces must NOT redefine this — the global mocks are how
    // we keep tests isolated from external services.
    setupFiles: [path.resolve(repoRoot, './vitest.setup.ts')],
    // Run tests sequentially to avoid race conditions in shared state
    sequence: {
      shuffle: false,
    },
    // Use forks pool in CI for better memory isolation during coverage collection
    pool: process.env.CI === 'true' ? 'forks' : 'threads',
    // Limit workers in CI to prevent memory exhaustion during coverage
    maxWorkers: process.env.CI === 'true' ? 2 : undefined,
    // Standard timeout for async operations
    testTimeout: 10000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportOnFailure: true,
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
