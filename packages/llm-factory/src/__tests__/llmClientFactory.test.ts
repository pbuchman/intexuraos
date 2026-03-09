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
const mockGlmGenerate = vi.fn();

class MockGeminiClient {
  generate = mockGeminiGenerate;
}

class MockGlmClient {
  generate = mockGlmGenerate;
}

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn(() => new MockGeminiClient()),
  createGeminiToolCallingClient: vi.fn(() => ({ run: vi.fn() })),
}));

vi.mock('@intexuraos/infra-glm', () => ({
  createGlmClient: vi.fn(() => new MockGlmClient()),
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

    it('creates GLM client for Zai models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Glm47,
        userId: 'user-123',
        pricing: createTestPricing(),
        logger: mockLogger,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGlmClient);
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
      ).toThrow('Unsupported LLM provider');
    });

    it('throws for Claude models which are not supported by factory', () => {
      expect(() =>
        createLlmClient({
          apiKey: 'test-key',
          model: LlmModels.ClaudeSonnet45,
          userId: 'user-123',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM provider');
    });

    it('throws for GPT models which are not supported by factory', () => {
      expect(() =>
        createLlmClient({
          apiKey: 'test-key',
          model: LlmModels.GPT4oMini,
          userId: 'user-123',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM provider');
    });

    it('throws for Perplexity models which are not supported by factory', () => {
      expect(() =>
        createLlmClient({
          apiKey: 'test-key',
          model: LlmModels.SonarPro,
          userId: 'user-123',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Unsupported LLM provider');
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

    it('throws for Zai provider (tool calling not supported)', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'glm-4.7' as any,
          userId: 'test-user',
          pricing: createTestPricing(),
          logger: mockLogger,
        })
      ).toThrow('Tool calling not supported for provider: zai');
    });

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
      ).toThrow('Tool calling not supported for provider');
    });
  });

  describe('isSupportedProvider', () => {
    it('returns true for Google provider', () => {
      expect(isSupportedProvider(LlmProviders.Google)).toBe(true);
    });

    it('returns true for Zai provider', () => {
      expect(isSupportedProvider(LlmProviders.Zai)).toBe(true);
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
        // TypeScript should know provider is 'google' | 'zai' here
        expect(provider === LlmProviders.Google || provider === LlmProviders.Zai).toBe(true);
      }
    });
  });
});
