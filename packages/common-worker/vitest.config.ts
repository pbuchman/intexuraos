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
          '**/__tests__/**',
          '**/testing/**',
          '**/index.ts',
          '**/dist/**',
          '**/node_modules/**',
        ],
      },
    },
  })
);
