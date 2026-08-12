/**
 * Tests for LlmAdapterFactory.
 */

import { describe, expect, it, vi } from 'vitest';
import { FakeUsageSink } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import {
  LegacyGoogleModels,
  LlmModels,
  LlmProviders,
  type ResearchModel,
} from '@intexuraos/llm-contract';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};
const fakeUsageSink = new FakeUsageSink();

vi.mock('../../../infra/llm/ClaudeAdapter.js', () => ({
  ClaudeAdapter: class MockClaudeAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(
      apiKey: string,
      model: string,
      userId: string,
      _logger: Logger,
      _usageSink: unknown
    ) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

vi.mock('../../../infra/llm/GptAdapter.js', () => ({
  GptAdapter: class MockGptAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(
      apiKey: string,
      model: string,
      userId: string,
      _logger: Logger,
      _usageSink: unknown
    ) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

vi.mock('../../../infra/llm/PerplexityAdapter.js', () => ({
  PerplexityAdapter: class MockPerplexityAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(
      apiKey: string,
      model: string,
      userId: string,
      _logger: Logger,
      _usageSink: unknown
    ) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

vi.mock('../../../infra/llm/OpenRouterAdapter.js', () => ({
  OpenRouterAdapter: class MockOpenRouterAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(
      apiKey: string,
      model: string,
      userId: string,
      _logger: Logger,
      _usageSink: unknown
    ) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

const { createSynthesizer, createTitleGenerator, createResearchProvider } =
  await import('../../../infra/llm/LlmAdapterFactory.js');

describe('LlmAdapterFactory', () => {
  describe('createResearchProvider', () => {
    it('rejects direct Gemini research models', () => {
      expect(() =>
        createResearchProvider(
          LegacyGoogleModels.Gemini25Pro as unknown as ResearchModel,
          'google-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Direct Google LLM models are disabled');
    });

    it('creates ClaudeAdapter for claude model', () => {
      const provider = createResearchProvider(
        LlmModels.ClaudeOpus46,
        'anthropic-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.ClaudeOpus46);
    });

    it('creates GptAdapter for openai model', () => {
      const provider = createResearchProvider(
        LlmModels.O4MiniDeepResearch,
        'openai-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.O4MiniDeepResearch);
    });

    it('creates PerplexityAdapter for perplexity model', () => {
      const provider = createResearchProvider(
        LlmModels.SonarPro,
        'perplexity-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('perplexity-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.SonarPro);
    });

    it('creates OpenRouterAdapter for openrouter model', () => {
      const openRouterModel = 'or:deepseek/deepseek-v3-0324';
      const provider = createResearchProvider(
        openRouterModel as ResearchModel,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openrouter-key');
      expect((provider as unknown as { model: string }).model).toBe(openRouterModel);
    });
  });

  describe('createSynthesizer', () => {
    it('rejects direct Gemini synthesis models', () => {
      expect(() =>
        createSynthesizer(
          LegacyGoogleModels.Gemini25Pro as unknown as ResearchModel,
          'google-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Direct Google LLM models are disabled');
    });

    it('throws error for claude model (synthesis not supported)', () => {
      expect(() =>
        createSynthesizer(
          LlmModels.ClaudeOpus46,
          'anthropic-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Anthropic does not support synthesis');
    });

    it('creates GptAdapter for openai model', () => {
      const synthesizer = createSynthesizer(
        LlmModels.O4MiniDeepResearch,
        'openai-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((synthesizer as unknown as { model: string }).model).toBe(
        LlmModels.O4MiniDeepResearch
      );
    });

    it('throws error for perplexity model (synthesis not supported)', () => {
      expect(() =>
        createSynthesizer(
          LlmModels.SonarPro,
          'perplexity-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Perplexity does not support synthesis');
    });

    it('creates OpenRouterAdapter for openrouter model', () => {
      const openRouterModel = 'or:deepseek/deepseek-v3-0324';
      const synthesizer = createSynthesizer(
        openRouterModel as ResearchModel,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('openrouter-key');
      expect((synthesizer as unknown as { model: string }).model).toBe(openRouterModel);
    });
  });

  describe('createTitleGenerator', () => {
    it('rejects direct Gemini title generation', () => {
      expect(() =>
        createTitleGenerator(
          LegacyGoogleModels.Gemini25Flash as unknown as ResearchModel,
          'google-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('Direct Google LLM models are disabled');
    });

    it('rejects title generators that cannot generate context labels', () => {
      expect(() =>
        createTitleGenerator(
          LlmModels.GPT54,
          'openai-key',
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow('OpenAI does not support context-label title generation');
    });

    it.each([
      [LlmModels.ClaudeOpus46, LlmProviders.Anthropic],
      [LlmModels.SonarPro, LlmProviders.Perplexity],
    ] as const)('rejects %s for title generation', (model, provider) => {
      expect(() =>
        createTitleGenerator(
          model,
          `${provider}-key`,
          'test-user-id',
          mockLogger,
          fakeUsageSink
        )
      ).toThrow(`${provider} does not support title generation`);
    });

    it('creates OpenRouterAdapter for title and context-label generation', () => {
      const model = 'or:minimax/minimax-m3' as ResearchModel;
      const generator = createTitleGenerator(
        model,
        'openrouter-key',
        'test-user-id',
        mockLogger,
        fakeUsageSink
      );

      expect((generator as unknown as { model: string }).model).toBe(model);
    });
  });
});
