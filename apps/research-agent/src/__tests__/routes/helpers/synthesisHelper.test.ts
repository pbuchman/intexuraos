/**
 * Tests for synthesis helper.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */

import { describe, it, expect, vi } from 'vitest';
import { createSynthesisProviders } from '../../../routes/helpers/synthesisHelper.js';
import type { DecryptedApiKeys, ServiceContainer } from '../../../services.js';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import * as openrouterModule from '@intexuraos/infra-openrouter';
import type { ResearchModel } from '../../../domain/research/index.js';

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

  it('throws when synthesis provider API key is undefined', () => {
    const apiKeys: DecryptedApiKeys = {
      // No anthropic key — will throw when using ClaudeSonnet45
    };

    expect(() =>
      createSynthesisProviders(
        LlmModels.ClaudeSonnet45,
        apiKeys,
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow(`No API key configured for provider '${LlmProviders.Anthropic}'`);
  });

  it('throws when synthesis provider API key is empty string', () => {
    const apiKeys: DecryptedApiKeys = {
      [LlmProviders.Anthropic]: '',
    };

    expect(() =>
      createSynthesisProviders(
        LlmModels.ClaudeSonnet45,
        apiKeys,
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow(`No API key configured for provider '${LlmProviders.Anthropic}'`);
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

  it('throws when OpenRouter model is not in the curated allowlist', () => {
    const apiKeys: DecryptedApiKeys = {
      openrouter: 'test-or-key',
    };

    // Use a non-allowlisted OpenRouter model ID (or: prefix with unknown model)
    const invalidModel = 'or:unknown-provider/not-in-allowlist' as ResearchModel;

    expect(() =>
      createSynthesisProviders(
        invalidModel,
        apiKeys,
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow("OpenRouter model 'or:unknown-provider/not-in-allowlist' is not in the curated allowlist");
  });

  it('uses allowlist pricing for valid OpenRouter models', () => {
    const apiKeys: DecryptedApiKeys = {
      openrouter: 'test-or-key',
    };

    // Use a valid allowlisted OR model
    const validOrModel = 'or:anthropic/claude-sonnet-4.6' as ResearchModel;

    const result = createSynthesisProviders(
      validOrModel,
      apiKeys,
      'user-123',
      mockServices,
      mockLogger as never
    );

    expect(result.synthesizer).toBeDefined();
  });

  it('throws when getAllowlistPricing returns undefined for an allowed model', () => {
    const apiKeys: DecryptedApiKeys = {
      openrouter: 'test-or-key',
    };

    const validOrModel = 'or:anthropic/claude-sonnet-4.6' as ResearchModel;

    // Temporarily make getAllowlistPricing return undefined while isAllowedModel still returns true
    const spy = vi.spyOn(openrouterModule, 'getAllowlistPricing').mockReturnValue(undefined);

    try {
      expect(() =>
        createSynthesisProviders(
          validOrModel,
          apiKeys,
          'user-123',
          mockServices,
          mockLogger as never
        )
      ).toThrow('No pricing for allowlisted model: or:anthropic/claude-sonnet-4.6');
    } finally {
      spy.mockRestore();
    }
  });
});
