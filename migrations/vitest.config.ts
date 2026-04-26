import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['__tests__/**/*.ts'],
    },
  })
);
