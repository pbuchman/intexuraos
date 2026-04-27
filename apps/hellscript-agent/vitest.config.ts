import { mergeConfig, defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedConfig } from '../../vitest.shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
      exclude: [
        'src/**/__tests__/**/*.fixture.ts',
        'src/**/__tests__/testUtils.ts',
        'src/**/__tests__/fake*.ts',
      ],
      alias: {
        '@intexuraos/common-core': resolve(__dirname, '../../packages/common-core/src'),
        '@intexuraos/common-http': resolve(__dirname, '../../packages/common-http/src'),
        '@intexuraos/http-contracts': resolve(__dirname, '../../packages/http-contracts/src'),
        '@intexuraos/http-server': resolve(__dirname, '../../packages/http-server/src'),
        '@intexuraos/infra-firestore': resolve(__dirname, '../../packages/infra-firestore/src'),
        '@intexuraos/infra-sentry': resolve(__dirname, '../../packages/infra-sentry/src'),
        '@intexuraos/infra-gemini': resolve(__dirname, '../../packages/infra-gemini/src'),
        '@intexuraos/llm-contract': resolve(__dirname, '../../packages/llm-contract/src'),
        '@intexuraos/llm-prompts': resolve(__dirname, '../../packages/llm-prompts/src'),
      },
      coverage: {
        // provider/reporter/thresholds inherited from sharedConfig
        include: ['src/**/*.ts'],
        exclude: ['src/**/__tests__/**/*.ts', 'src/index.ts'],
        all: true,
      },
    },
  })
);
