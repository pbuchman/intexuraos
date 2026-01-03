/**
 * Tests for LlmAdapterFactory.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../infra/llm/GeminiAdapter.js', () => ({
  GeminiAdapter: class MockGeminiAdapter {
    apiKey: string;
    model: string | undefined;
    constructor(apiKey: string, model?: string) {
      this.apiKey = apiKey;
      this.model = model;
    }
  },
}));

vi.mock('../../../infra/llm/ClaudeAdapter.js', () => ({
  ClaudeAdapter: class MockClaudeAdapter {
    apiKey: string;
    model: string | undefined;
    constructor(apiKey: string, model?: string) {
      this.apiKey = apiKey;
      this.model = model;
    }
  },
}));

vi.mock('../../../infra/llm/GptAdapter.js', () => ({
  GptAdapter: class MockGptAdapter {
    apiKey: string;
    model: string | undefined;
    constructor(apiKey: string, model?: string) {
      this.apiKey = apiKey;
      this.model = model;
    }
  },
}));

const { createLlmProviders, createSynthesizer, createTitleGenerator, createResearchProvider } =
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
      expect((providers.google as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect(providers.openai).toBeDefined();
      expect((providers.openai as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect(providers.anthropic).toBeDefined();
      expect((providers.anthropic as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
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

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('google-key');
    });

    it('creates ClaudeAdapter for anthropic provider', () => {
      const synthesizer = createSynthesizer('anthropic', 'anthropic-key');

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
    });

    it('creates GptAdapter for openai provider', () => {
      const synthesizer = createSynthesizer('openai', 'openai-key');

      expect((synthesizer as unknown as { apiKey: string }).apiKey).toBe('openai-key');
    });
  });

  describe('createTitleGenerator', () => {
    it('creates GeminiAdapter for title generation', () => {
      const generator = createTitleGenerator('google-key');

      expect((generator as unknown as { apiKey: string }).apiKey).toBe('google-key');
    });
  });

  describe('createResearchProvider', () => {
    it('creates GeminiAdapter for google provider with deep search (default)', () => {
      const provider = createResearchProvider('google', 'google-key');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeUndefined();
    });

    it('creates ClaudeAdapter for anthropic provider with deep search', () => {
      const provider = createResearchProvider('anthropic', 'anthropic-key', 'deep');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeUndefined();
    });

    it('creates GptAdapter for openai provider with deep search', () => {
      const provider = createResearchProvider('openai', 'openai-key', 'deep');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeUndefined();
    });

    it('creates GeminiAdapter with default model for quick search', () => {
      const provider = createResearchProvider('google', 'google-key', 'quick');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('google-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeDefined();
    });

    it('creates ClaudeAdapter with default model for quick search', () => {
      const provider = createResearchProvider('anthropic', 'anthropic-key', 'quick');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('anthropic-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeDefined();
    });

    it('creates GptAdapter with default model for quick search', () => {
      const provider = createResearchProvider('openai', 'openai-key', 'quick');

      expect((provider as unknown as { apiKey: string }).apiKey).toBe('openai-key');
      expect((provider as unknown as { model: string | undefined }).model).toBeDefined();
    });
  });
});
