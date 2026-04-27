import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'node',
      coverage: {
        // provider/reporter/thresholds inherited from sharedConfig
        exclude: ['**/__tests__/**', '**/dist/**', '**/node_modules/**'],
      },
    },
  })
);
