import { mergeConfig, defineConfig } from 'vitest/config';
import { sharedConfig } from '../vitest.shared.js';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['__tests__/**/*.ts'],
      coverage: {
        // Migrations are intentionally exempt from the 95% coverage gate —
        // they're one-shot Firestore index/migration scripts whose value is
        // verified by integration runs, not branch coverage. Clear the
        // thresholds inherited from sharedConfig.
        thresholds: {},
      },
    },
  })
);
