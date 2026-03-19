import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    exclude: ['src/**/__tests__/**/*.fixture.ts', 'src/**/__tests__/testUtils.ts', 'src/**/__tests__/test-helpers.ts'],
    alias: {
      '@intexuraos/common-core': resolve(__dirname, '../../packages/common-core/src'),
      '@intexuraos/common-http': resolve(__dirname, '../../packages/common-http/src'),
      '@intexuraos/http-contracts': resolve(__dirname, '../../packages/http-contracts/src'),
      '@intexuraos/http-server': resolve(__dirname, '../../packages/http-server/src'),
      '@intexuraos/infra-firestore': resolve(__dirname, '../../packages/infra-firestore/src'),
      '@intexuraos/infra-sentry': resolve(__dirname, '../../packages/infra-sentry/src'),
      '@intexuraos/infra-gemini': resolve(__dirname, '../../packages/infra-gemini/src'),
      '@intexuraos/llm-contract': resolve(__dirname, '../../packages/llm-contract/src'),
      '@intexuraos/llm-pricing': resolve(__dirname, '../../packages/llm-pricing/src'),
      '@intexuraos/llm-prompts': resolve(__dirname, '../../packages/llm-prompts/src'),
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**/*.ts', 'src/domain/types.ts', 'src/index.ts'],
      all: true,
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
