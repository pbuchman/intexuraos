/**
 * Tests for LlmAdapterFactory.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../infra/llm/GeminiAdapter.js', () => ({
  GeminiAdapter: class MockGeminiAdapter {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
    }
  },
}));

vi.mock('../../../infra/llm/ClaudeAdapter.js', () => ({
  ClaudeAdapter: class MockClaudeAdapter {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
    }
  },
}));

vi.mock('../../../infra/llm/GptAdapter.js', () => ({
  GptAdapter: class MockGptAdapter {
    apiKey: string;
    constructor(apiKey: string) {
      this.apiKey = apiKey;
    }
  },
}));

const { createLlmProviders, createSynthesizer, createTitleGenerator } =
  await import('../../../infra/llm/LlmAdapterFactory.js');

describe('LlmAdapterFactory', () => {
  describe('createLlmProviders', () => {
    it('creates all providers when all keys are provided', () => {
      const keys = {
        google: 'google-key',
        openai: 'openai-key',
        anthropic: 'anthropic-key',
      };

      const providers = createLlmProviders(keys);

      expect(providers.google).toBeDefined();
      expect((providers.google as { apiKey: string }).apiKey).toBe('google-key');
      expect(providers.openai).toBeDefined();
      expect((providers.openai as { apiKey: string }).apiKey).toBe('openai-key');
      expect(providers.anthropic).toBeDefined();
      expect((providers.anthropic as { apiKey: string }).apiKey).toBe('anthropic-key');
    });

    it('creates only providers with available keys', () => {
      const keys = {
        google: 'google-key',
      };

      const providers = createLlmProviders(keys);

      expect(providers.google).toBeDefined();
      expect(providers.openai).toBeUndefined();
      expect(providers.anthropic).toBeUndefined();
    });

    it('returns empty object when no keys provided', () => {
      const keys = {};

      const providers = createLlmProviders(keys);

      expect(providers.google).toBeUndefined();
      expect(providers.openai).toBeUndefined();
      expect(providers.anthropic).toBeUndefined();
    });
  });

  describe('createSynthesizer', () => {
    it('creates GeminiAdapter for google provider', () => {
      const synthesizer = createSynthesizer('google', 'google-key');

      expect((synthesizer as { apiKey: string }).apiKey).toBe('google-key');
    });

    it('creates ClaudeAdapter for anthropic provider', () => {
      const synthesizer = createSynthesizer('anthropic', 'anthropic-key');

      expect((synthesizer as { apiKey: string }).apiKey).toBe('anthropic-key');
    });

    it('creates GptAdapter for openai provider', () => {
      const synthesizer = createSynthesizer('openai', 'openai-key');

      expect((synthesizer as { apiKey: string }).apiKey).toBe('openai-key');
    });
  });

  describe('createTitleGenerator', () => {
    it('creates GeminiAdapter for title generation', () => {
      const generator = createTitleGenerator('google-key');

      expect((generator as { apiKey: string }).apiKey).toBe('google-key');
    });
  });
});
