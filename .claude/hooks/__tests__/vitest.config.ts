import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    // Only run tests in the __tests__ directory, not the entire repo
    include: ['./*.test.ts'],
    root: __dirname,
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 10000,
    hookTimeout: 30000,
    // Hook tests run sequentially since they access shared temp files
    sequence: {
      shuffle: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      // Only cover helper files, not test files
      include: ['helpers/**/*.ts'],
      exclude: ['**/*.test.ts', '**/fixtures/**'],
      // Don't enforce coverage thresholds on hook tests themselves
      // (they're test infrastructure, not production code)
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
