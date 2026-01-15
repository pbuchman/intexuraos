/**
 * Tests for LlmAdapterFactory.
 */

import { describe, expect, it, vi } from 'vitest';
import { TEST_PRICING } from '@intexuraos/llm-pricing';
import type { Logger } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';

const testPricing = TEST_PRICING;
const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

vi.mock('../../../infra/llm/GeminiAdapter.js', () => ({
  GeminiAdapter: class MockGeminiAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(apiKey: string, model: string, userId: string, _pricing: unknown, _logger: Logger) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

vi.mock('../../../infra/llm/ClaudeAdapter.js', () => ({
  ClaudeAdapter: class MockClaudeAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(apiKey: string, model: string, userId: string, _pricing: unknown, _logger: Logger) {
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
    constructor(apiKey: string, model: string, userId: string, _pricing: unknown, _logger: Logger) {
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
    constructor(apiKey: string, model: string, userId: string, _pricing: unknown, _logger: Logger) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
      this.logger = _logger;
    }
  },
}));

vi.mock('../../../infra/llm/GlmAdapter.js', () => ({
  GlmAdapter: class MockGlmAdapter {
    apiKey: string;
    model: string;
    userId: string;
    logger: Logger;
    constructor(apiKey: string, model: string, userId: string, _pricing: unknown, _logger: Logger) {
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
    it('creates GeminiAdapter for gemini model', () => {
      const provider = createResearchProvider(
        LlmModels.Gemini25Pro,
        'google-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.Gemini25Pro);
    });

    it('creates ClaudeAdapter for claude model', () => {
      const provider = createResearchProvider(
        LlmModels.ClaudeOpus45,
        'anthropic-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.ClaudeOpus45);
    });

    it('creates GptAdapter for openai model', () => {
      const provider = createResearchProvider(
        LlmModels.O4MiniDeepResearch,
        'openai-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.O4MiniDeepResearch);
    });

    it('creates PerplexityAdapter for perplexity model', () => {
      const provider = createResearchProvider(
        LlmModels.SonarPro,
        'perplexity-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('perplexity-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.SonarPro);
    });

    it('creates GlmAdapter for zai model', () => {
      const provider = createResearchProvider(
        LlmModels.Glm47,
        'zai-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('zai-key');
      expect((provider as unknown as { model: string }).model).toBe(LlmModels.Glm47);
    });
  });

  describe('createSynthesizer', () => {
    it('creates GeminiAdapter for gemini model', () => {
      const synthesizer = createSynthesizer(
        LlmModels.Gemini25Pro,
        'google-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((synthesizer as unknown as { model: string }).model).toBe(LlmModels.Gemini25Pro);
    });

    it('throws error for claude model (synthesis not supported)', () => {
      expect(() =>
        createSynthesizer(LlmModels.ClaudeOpus45, 'anthropic-key', 'test-user-id', testPricing, mockLogger)
      ).toThrow('Anthropic does not support synthesis');
    });

    it('creates GptAdapter for openai model', () => {
      const synthesizer = createSynthesizer(
        LlmModels.O4MiniDeepResearch,
        'openai-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((synthesizer as unknown as { model: string }).model).toBe(
        LlmModels.O4MiniDeepResearch
      );
    });

    it('throws error for perplexity model (synthesis not supported)', () => {
      expect(() =>
        createSynthesizer(LlmModels.SonarPro, 'perplexity-key', 'test-user-id', testPricing, mockLogger)
      ).toThrow('Perplexity does not support synthesis');
    });

    it('creates GlmAdapter for zai model', () => {
      const synthesizer = createSynthesizer(
        LlmModels.Glm47,
        'zai-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('zai-key');
      expect((synthesizer as unknown as { model: string }).model).toBe(LlmModels.Glm47);
    });
  });

  describe('createTitleGenerator', () => {
    it('creates GeminiAdapter for title generation', () => {
      const generator = createTitleGenerator(
        LlmModels.Gemini20Flash,
        'google-key',
        'test-user-id',
        testPricing,
        mockLogger
      );

      expect((generator as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((generator as unknown as { model: string }).model).toBe(LlmModels.Gemini20Flash);
    });
  });
});
