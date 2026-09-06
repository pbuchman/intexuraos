/** Tests for OpenRouter-only synthesis provider wiring. */

/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterModelId, LlmModels } from '@intexuraos/llm-contract';
import { createSynthesisProviders } from '../../../routes/helpers/synthesisHelper.js';
import type { ResearchModel } from '../../../domain/research/index.js';
import type { DecryptedApiKeys, ServiceContainer } from '../../../services.js';

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
};

const SYNTHESIS_MODEL = createOpenRouterModelId('openai/gpt-5.4') as ResearchModel;

describe('createSynthesisProviders', () => {
  const mockCreateSynthesizer = vi.fn(() => ({
    synthesize: async () => ({
      ok: true,
      value: { output: 'test', usage: { inputTokens: 10, outputTokens: 5 } },
    }),
  }));
  const mockCreateContextInferrer = vi.fn(() => ({
    inferContexts: async () => ({
      ok: true,
      value: { contexts: [], usage: { inputTokens: 5, outputTokens: 2 } },
    }),
  }));

  const mockServices: ServiceContainer = {
    createSynthesizer: mockCreateSynthesizer,
    createContextInferrer: mockCreateContextInferrer,
  } as unknown as ServiceContainer;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the OpenRouter key for synthesizer and context inference', () => {
    createSynthesisProviders(
      SYNTHESIS_MODEL,
      { openrouter: 'test-or-key' },
      'user-123',
      mockServices,
      mockLogger as never,
      'research-abc'
    );

    expect(mockCreateSynthesizer).toHaveBeenCalledWith(
      SYNTHESIS_MODEL,
      'test-or-key',
      'user-123',
      mockLogger,
      'research-abc'
    );
    expect(mockCreateContextInferrer).toHaveBeenCalledWith(
      'or:minimax/minimax-m3',
      'test-or-key',
      'user-123',
      mockLogger,
      'research-abc'
    );
  });

  it('supports callers that omit researchId', () => {
    createSynthesisProviders(
      SYNTHESIS_MODEL,
      { openrouter: 'test-or-key' },
      'user-123',
      mockServices,
      mockLogger as never
    );

    expect(mockCreateSynthesizer).toHaveBeenCalledWith(
      SYNTHESIS_MODEL,
      'test-or-key',
      'user-123',
      mockLogger,
      undefined
    );
  });

  it.each([undefined, ''])('requires a non-empty OpenRouter key (%s)', (openrouter) => {
    const apiKeys = (openrouter === undefined ? {} : { openrouter }) as DecryptedApiKeys;

    expect(() =>
      createSynthesisProviders(
        SYNTHESIS_MODEL,
        apiKeys,
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow("No API key configured for provider 'openrouter'");
  });

  it('rejects a direct-provider synthesis model', () => {
    expect(() =>
      createSynthesisProviders(
        LlmModels.GPT54 as unknown as ResearchModel,
        { openrouter: 'test-or-key' },
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow(`Research synthesis model '${LlmModels.GPT54}' is not executable`);
  });

  it('rejects an allowlisted research model that is not enabled for synthesis', () => {
    const researchOnlyModel = createOpenRouterModelId(
      'anthropic/claude-sonnet-4.6'
    ) as ResearchModel;

    expect(() =>
      createSynthesisProviders(
        researchOnlyModel,
        { openrouter: 'test-or-key' },
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow(`Research synthesis model '${researchOnlyModel}' is not executable`);
  });

  it('rejects a non-allowlisted OpenRouter synthesis model', () => {
    const invalidModel = 'or:unknown-provider/not-in-allowlist' as ResearchModel;

    expect(() =>
      createSynthesisProviders(
        invalidModel,
        { openrouter: 'test-or-key' },
        'user-123',
        mockServices,
        mockLogger as never
      )
    ).toThrow(`Research synthesis model '${invalidModel}' is not executable`);
  });
});
