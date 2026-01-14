/**
 * Tests for synthesis helper.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */

import { describe, it, expect } from 'vitest';
import { createSynthesisProviders } from '../../../routes/helpers/synthesisHelper.js';
import type { DecryptedApiKeys, ServiceContainer } from '../../../services.js';
import { LlmModels } from '@intexuraos/llm-contract';

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

describe('createSynthesisProviders', () => {
  const mockServices: ServiceContainer = {
    createSynthesizer: () => ({
      synthesize: async () => ({
        ok: true,
        value: { output: 'test', usage: { inputTokens: 10, outputTokens: 5 } },
      }),
    }),
    createContextInferrer: () => ({
      inferContexts: async () => ({
        ok: true,
        value: { contexts: [], usage: { inputTokens: 5, outputTokens: 2 } },
      }),
    }),
    pricingContext: {
      getPricing: () => ({ inputCostPerMillionTokens: 0.1, outputCostPerMillionTokens: 0.2 }),
    },
  } as unknown as ServiceContainer;

  it('creates synthesizer and contextInferrer when Google API key is provided', () => {
    const apiKeys: DecryptedApiKeys = {
      anthropic: 'test-anthropic-key',
      google: 'test-google-key',
    };

    const result = createSynthesisProviders(
      LlmModels.ClaudeSonnet45,
      apiKeys,
      'user-123',
      mockServices,
      mockLogger as never
    );

    expect(result.synthesizer).toBeDefined();
    expect(result.contextInferrer).toBeDefined();
  });

  it('creates only synthesizer when Google API key is undefined', () => {
    const apiKeys: DecryptedApiKeys = {
      anthropic: 'test-anthropic-key',
      // No google key
    };

    const result = createSynthesisProviders(
      LlmModels.ClaudeSonnet45,
      apiKeys,
      'user-123',
      mockServices,
      mockLogger as never
    );

    expect(result.synthesizer).toBeDefined();
    expect(result.contextInferrer).toBeUndefined();
  });
});
