import { defineConfig } from 'vitest/config';

// EXCEPTION (per INT-1535 / acceptance criterion #6): e2e/ is the single
// documented opt-out from `vitest.shared.ts` inheritance.
//
// Why opt out:
//   - setupFiles: [] — E2E targets REAL services (Firebase, Notion, fetch),
//     and must NOT load the global Firebase/Notion/fetch mocks defined in
//     vitest.setup.ts. mergeConfig() concatenates arrays, so we cannot
//     reliably "override" setupFiles via inheritance — defineConfig is the
//     only way to guarantee an empty setupFiles array.
//   - coverage thresholds — E2E tests measure integration paths, not unit
//     coverage; the 95% global thresholds are inappropriate here.
//   - pool/timeouts — E2E uses forks + singleFork to run sequentially with
//     long timeouts for live network/IO; the shared base targets fast unit tests.
export default defineConfig({
  test: {
    root: './e2e',
    testTimeout: 120_000, // 2 minutes for E2E tests
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // E2E tests must run sequentially
      },
    },
    environment: 'node',
    setupFiles: [],
    include: ['tests/**/*.spec.ts'],
    exclude: [],
    coverage: {
      provider: 'v8',
      // E2E tests don't need coverage reporting
      // They test integration, not unit-level coverage
    },
  },
});
