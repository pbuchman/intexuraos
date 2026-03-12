import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmProviders, LlmModels, type ModelPricing } from '@intexuraos/llm-contract';
import type { Logger } from '@intexuraos/common-core';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockGeminiGenerate = vi.fn();

class MockGeminiClient {
  generate = mockGeminiGenerate;
}

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn(() => new MockGeminiClient()),
  createGeminiToolCallingClient: vi.fn(() => ({ run: vi.fn() })),
}));

const { createLlmClient, createToolCallingClient, isSupportedProvider } =
  await import('../llmClientFactory.js');

const createTestPricing = (overrides: Partial<ModelPricing> = {}): ModelPricing => ({
  inputPricePerMillion: 0.6,
  outputPricePerMillion: 2.2,
  webSearchCostPerCall: 0.005,
  ...overrides,
});

describe('llmClientFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLlmClient', () => {
    it('creates Gemini client for Google models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('creates Gemini 2.5 Pro client', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Pro,
        userId: 'user-123',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('creates client for valid Gemini models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        pricing: createTestPricing(),
        logger: mockLogger,
      });
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('throws for unsupported provider models', () => {
      expect(() =>
        createLlmClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'gemini-2.5-flash-exp-unsupported' as any,
          userId: 'user-123',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM model');
    });

    it('throws for models from unsupported providers', () => {
      // Using invalid model strings that are not in the valid model list
      // This triggers "Unsupported LLM model" which is correct behavior
      expect(() =>
        createLlmClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'claude-opus' as any,
          userId: 'user-123',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM model');
    });
  });

  describe('createToolCallingClient', () => {
    it('creates tool calling client for Gemini model', () => {
      const client = createToolCallingClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'test-user',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      expect(client.run).toBeDefined();
    });

    // Note: ZAI provider tests removed - GLM-4.7 is no longer a valid model

    it('throws for unsupported provider', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'claude-sonnet-4-5-20250514' as any,
          userId: 'test-user',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM model');
    });
  });

  describe('isSupportedProvider', () => {
    it('returns true for Google provider', () => {
      expect(isSupportedProvider(LlmProviders.Google)).toBe(true);
    });

    it('returns false for Zai provider (no longer supported)', () => {
      expect(isSupportedProvider('zai')).toBe(false);
    });

    it('returns false for Anthropic provider', () => {
      expect(isSupportedProvider(LlmProviders.Anthropic)).toBe(false);
    });

    it('returns false for OpenAI provider', () => {
      expect(isSupportedProvider(LlmProviders.OpenAI)).toBe(false);
    });

    it('returns false for Perplexity provider', () => {
      expect(isSupportedProvider(LlmProviders.Perplexity)).toBe(false);
    });

    it('returns false for unknown provider strings', () => {
      expect(isSupportedProvider('unknown')).toBe(false);
      expect(isSupportedProvider('')).toBe(false);
    });

    it('type narrows correctly for supported providers', () => {
      const provider = LlmProviders.Google as string;
      if (isSupportedProvider(provider)) {
        // TypeScript should know provider is 'google' here
        expect(provider === LlmProviders.Google).toBe(true);
      }
    });
  });
});
