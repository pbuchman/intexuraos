import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      coverage: {
        include: ['src/**/*.ts'],
        exclude: [
          'src/__tests__/**',
          'src/testing/**',
          // Only the runtime barrel is excluded — sub-barrels under nested
          // dirs (if any are added later) will require their own entry.
          'src/index.ts',
          '**/dist/**',
          '**/node_modules/**',
        ],
      },
    },
  })
);
