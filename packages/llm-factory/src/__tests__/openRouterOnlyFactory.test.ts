import { describe, expect, it } from 'vitest';
import { IntexuraOSError } from '@intexuraos/common-core';
import { LlmModels, LlmProviders, type OpenRouterModelId } from '@intexuraos/llm-contract';
import { createFakeUsageSink } from '@intexuraos/llm-pricing';
import * as publicFactory from '../index.js';
import { createLlmClient, isSupportedProvider } from '../llmClientFactory.js';

const logger = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
};

describe('OpenRouter-only LLM factory', () => {
  it.each([LlmModels.GPT54, LlmModels.ClaudeSonnet46, LlmModels.Sonar])(
    'rejects direct model %s',
    (model) => {
      expect(() =>
        createLlmClient({
          apiKey: 'direct-key',
          model: model as OpenRouterModelId,
          userId: 'user-1',
          logger,
          usageSink: createFakeUsageSink(),
        })
      ).toThrow(IntexuraOSError);
    }
  );

  it('reports only OpenRouter as supported', () => {
    expect(isSupportedProvider(LlmProviders.OpenRouter)).toBe(true);
    expect(isSupportedProvider(LlmProviders.OpenAI)).toBe(false);
    expect(isSupportedProvider(LlmProviders.Anthropic)).toBe(false);
    expect(isSupportedProvider(LlmProviders.Perplexity)).toBe(false);
  });

  it('does not expose direct-provider client constructors', () => {
    expect(publicFactory).not.toHaveProperty('createClaudeGenerateClient');
    expect(publicFactory).not.toHaveProperty('createGptGenerateClient');
    expect(publicFactory).not.toHaveProperty('createPerplexityGenerateClient');
  });
});
