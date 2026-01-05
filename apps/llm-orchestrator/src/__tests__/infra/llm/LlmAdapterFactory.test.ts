/**
 * Tests for LlmAdapterFactory.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../infra/llm/GeminiAdapter.js', () => ({
  GeminiAdapter: class MockGeminiAdapter {
    apiKey: string;
    model: string;
    userId: string;
    constructor(apiKey: string, model: string, userId: string) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
    }
  },
}));

vi.mock('../../../infra/llm/ClaudeAdapter.js', () => ({
  ClaudeAdapter: class MockClaudeAdapter {
    apiKey: string;
    model: string;
    userId: string;
    constructor(apiKey: string, model: string, userId: string) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
    }
  },
}));

vi.mock('../../../infra/llm/GptAdapter.js', () => ({
  GptAdapter: class MockGptAdapter {
    apiKey: string;
    model: string;
    userId: string;
    constructor(apiKey: string, model: string, userId: string) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
    }
  },
}));

vi.mock('../../../infra/llm/PerplexityAdapter.js', () => ({
  PerplexityAdapter: class MockPerplexityAdapter {
    apiKey: string;
    model: string;
    userId: string;
    constructor(apiKey: string, model: string, userId: string) {
      this.apiKey = apiKey;
      this.model = model;
      this.userId = userId;
    }
  },
}));

const { createSynthesizer, createTitleGenerator, createResearchProvider } =
  await import('../../../infra/llm/LlmAdapterFactory.js');

describe('LlmAdapterFactory', () => {
  describe('createResearchProvider', () => {
    it('creates GeminiAdapter for gemini model', () => {
      const provider = createResearchProvider('gemini-2.5-pro', 'google-key', 'test-user-id');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((provider as unknown as { model: string }).model).toBe('gemini-2.5-pro');
    });

    it('creates ClaudeAdapter for claude model', () => {
      const provider = createResearchProvider(
        'claude-opus-4-5-20251101',
        'anthropic-key',
        'test-user-id'
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
      expect((provider as unknown as { model: string }).model).toBe('claude-opus-4-5-20251101');
    });

    it('creates GptAdapter for openai model', () => {
      const provider = createResearchProvider(
        'o4-mini-deep-research',
        'openai-key',
        'test-user-id'
      );

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((provider as unknown as { model: string }).model).toBe('o4-mini-deep-research');
    });

    it('creates PerplexityAdapter for perplexity model', () => {
      const provider = createResearchProvider('sonar-pro', 'perplexity-key', 'test-user-id');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('perplexity-key');
      expect((provider as unknown as { model: string }).model).toBe('sonar-pro');
    });
  });

  describe('createSynthesizer', () => {
    it('creates GeminiAdapter for gemini model', () => {
      const synthesizer = createSynthesizer('gemini-2.5-pro', 'google-key', 'test-user-id');

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((synthesizer as unknown as { model: string }).model).toBe('gemini-2.5-pro');
    });

    it('throws error for claude model (synthesis not supported)', () => {
      expect(() =>
        createSynthesizer('claude-opus-4-5-20251101', 'anthropic-key', 'test-user-id')
      ).toThrow('Anthropic does not support synthesis');
    });

    it('creates GptAdapter for openai model', () => {
      const synthesizer = createSynthesizer('o4-mini-deep-research', 'openai-key', 'test-user-id');

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((synthesizer as unknown as { model: string }).model).toBe('o4-mini-deep-research');
    });

    it('throws error for perplexity model (synthesis not supported)', () => {
      expect(() => createSynthesizer('sonar-pro', 'perplexity-key', 'test-user-id')).toThrow(
        'Perplexity does not support synthesis'
      );
    });
  });

  describe('createTitleGenerator', () => {
    it('creates GeminiAdapter for title generation', () => {
      const generator = createTitleGenerator('gemini-2.0-flash', 'google-key', 'test-user-id');

      expect((generator as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((generator as unknown as { model: string }).model).toBe('gemini-2.0-flash');
    });
  });
});
