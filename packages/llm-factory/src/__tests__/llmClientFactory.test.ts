import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterToolCallingModels, LlmProviders, LlmModels } from '@intexuraos/llm-contract';
import { IntexuraOSError, type Logger } from '@intexuraos/common-core';
import { FakeUsageSink } from '@intexuraos/llm-pricing';

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const mockUsageSink = new FakeUsageSink();

const mockGeminiGenerate = vi.fn();

class MockGeminiClient {
  generate = mockGeminiGenerate;
}

const mockOrGenerate = vi.fn();
const mockOrGenerateChat = vi.fn();

class MockOpenRouterGenerateClient {
  generate = mockOrGenerate;
  generateChat = mockOrGenerateChat;
}

const mockClaudeGenerate = vi.fn();

class MockClaudeGenerateClient {
  generate = mockClaudeGenerate;
}

const mockGptGenerate = vi.fn();

class MockGptGenerateClient {
  generate = mockGptGenerate;
}

const mockPerplexityGenerate = vi.fn();

class MockPerplexityGenerateClient {
  generate = mockPerplexityGenerate;
}

vi.mock('@intexuraos/infra-gemini', () => ({
  createGeminiClient: vi.fn(() => new MockGeminiClient()),
  createGeminiToolCallingClient: vi.fn(() => ({ run: vi.fn() })),
}));

vi.mock('@intexuraos/infra-openrouter', () => ({
  createOpenRouterToolCallingClient: vi.fn(() => ({ run: vi.fn() })),
}));

vi.mock('../openRouterGenerateClient.js', () => ({
  createOpenRouterGenerateClient: vi.fn(() => new MockOpenRouterGenerateClient()),
}));

vi.mock('../claudeGenerateClient.js', () => ({
  createClaudeGenerateClient: vi.fn(() => new MockClaudeGenerateClient()),
}));

vi.mock('../gptGenerateClient.js', () => ({
  createGptGenerateClient: vi.fn(() => new MockGptGenerateClient()),
}));

vi.mock('../perplexityGenerateClient.js', () => ({
  createPerplexityGenerateClient: vi.fn(() => new MockPerplexityGenerateClient()),
}));

const { createLlmClient, createToolCallingClient, isSupportedProvider } =
  await import('../llmClientFactory.js');

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
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('creates Gemini 2.5 Pro client', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Pro,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('creates client for valid Gemini models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
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
          logger: mockLogger,
          usageSink: mockUsageSink,
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
          logger: mockLogger,
          usageSink: mockUsageSink,
        })
      ).toThrow('Unsupported LLM model');
    });

    it('creates Claude client for Anthropic models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.ClaudeHaiku35,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockClaudeGenerateClient);
    });

    it('creates GPT client for OpenAI models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.GPT4oMini,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockGptGenerateClient);
    });

    it('creates Perplexity client for Perplexity models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.SonarPro,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockPerplexityGenerateClient);
    });

    it('returns a defined client for each supported provider', () => {
      const baseConfig = {
        apiKey: 'test-key',
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      };

      const gemini = createLlmClient({ ...baseConfig, model: LlmModels.Gemini25Flash });
      const claude = createLlmClient({ ...baseConfig, model: LlmModels.ClaudeHaiku35 });
      const gpt = createLlmClient({ ...baseConfig, model: LlmModels.GPT4oMini });
      const perplexity = createLlmClient({ ...baseConfig, model: LlmModels.SonarPro });
      const openrouter = createLlmClient({
        ...baseConfig,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'or:google/gemma-4-31b-it:free' as any,
      });

      expect(gemini).toBeDefined();
      expect(gemini.generate).toBeDefined();
      expect(claude).toBeDefined();
      expect(claude.generate).toBeDefined();
      expect(gpt).toBeDefined();
      expect(gpt.generate).toBeDefined();
      expect(perplexity).toBeDefined();
      expect(perplexity.generate).toBeDefined();
      expect(openrouter).toBeDefined();
      expect(openrouter.generate).toBeDefined();
    });

    it('adds an INVALID_REQUEST generateChat fallback to non-OpenRouter clients', async () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      await expect(
        client.generateChat?.([{ role: 'user', content: 'Hello' }], {
          promptType: 'whatsapp-conversation-assistant',
        })
      ).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        message: 'Chat message generation is only supported for OpenRouter clients',
      });
      expect(client).toBeInstanceOf(MockGeminiClient);
    });

    it('forwards ownerType to createClaudeGenerateClient when passed', async () => {
      const { createClaudeGenerateClient } = await import('../claudeGenerateClient.js');

      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.ClaudeHaiku35,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(vi.mocked(createClaudeGenerateClient)).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('forwards ownerType to createGptGenerateClient when passed', async () => {
      const { createGptGenerateClient } = await import('../gptGenerateClient.js');

      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.GPT4oMini,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(vi.mocked(createGptGenerateClient)).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('forwards ownerType to createPerplexityGenerateClient when passed', async () => {
      const { createPerplexityGenerateClient } = await import('../perplexityGenerateClient.js');

      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.SonarPro,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(vi.mocked(createPerplexityGenerateClient)).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('creates OpenRouter client for or: prefixed models', () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'or:google/gemma-4-31b-it:free' as any,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      expect(client.generate).toBeDefined();
      expect(client).toBeInstanceOf(MockOpenRouterGenerateClient);
    });
  });

  describe('createToolCallingClient', () => {
    it('creates tool calling client for Gemini model', () => {
      const client = createToolCallingClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(client.run).toBeDefined();
    });

    it('creates OpenRouter tool calling client for or: prefixed models', async () => {
      const { createOpenRouterToolCallingClient } = await import('@intexuraos/infra-openrouter');

      const client = createToolCallingClient({
        apiKey: 'test-key',
        model: OpenRouterToolCallingModels.Gemini3FlashPreview,
        userId: 'test-user',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(client.run).toBeDefined();
      expect(createOpenRouterToolCallingClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'test-key',
          model: 'google/gemini-3-flash-preview',
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
          ownerType: 'user',
        })
      );
    });

    it('throws for invalid model', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'nonexistent-model' as any,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        })
      ).toThrow('Unsupported LLM model');
    });

    it('throws for unsupported OpenRouter tool calling model', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'or:some/unknown-model' as any,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        })
      ).toThrow('Unsupported LLM model');
    });

    it('throws for valid Google model that is not a tool calling model', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: LlmModels.Gemini25Pro as any,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        })
      ).toThrow('Unsupported LLM model');
    });

    it('throws for valid non-Google model (provider not supported)', () => {
      expect(() =>
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: LlmModels.ClaudeOpus46 as any,
          userId: 'test-user',
          logger: mockLogger,
          usageSink: mockUsageSink,
        })
      ).toThrow('Tool calling not supported for provider: anthropic');
    });
  });

  describe('LlmClientConfig.ownerType propagation', () => {
    it('forwards ownerType to createOpenRouterGenerateClient when passed', async () => {
      const { createOpenRouterGenerateClient } = await import('../openRouterGenerateClient.js');

      createLlmClient({
        apiKey: 'test-key',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'or:google/gemma-4-31b-it:free' as any,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(vi.mocked(createOpenRouterGenerateClient)).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('forwards ownerType to createGeminiClient when passed', async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');

      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
        ownerType: 'user',
      });

      expect(vi.mocked(createGeminiClient)).toHaveBeenCalledWith(
        expect.objectContaining({ ownerType: 'user' })
      );
    });

    it('omits ownerType from config when not provided', async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');

      createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      const callArg = vi.mocked(createGeminiClient).mock.calls[0]?.[0] as unknown as Record<
        string,
        unknown
      >;
      expect(callArg?.['ownerType']).toBeUndefined();
    });
  });

  describe('LlmGenerateClient.generate with options', () => {
    it('should accept promptType in generate options', async () => {
      const client = createLlmClient({
        apiKey: 'test-key',
        model: LlmModels.Gemini25Flash,
        userId: 'user-123',
        logger: mockLogger,
        usageSink: mockUsageSink,
      });

      // Mock the generate to return success
      mockGeminiGenerate.mockResolvedValueOnce({
        ok: true,
        value: {
          content: 'test response',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            costUsd: 0.001,
          },
        },
      });

      // Should accept options with promptType
      const result = await client.generate('test prompt', { promptType: 'linear-issue-title' });
      expect(result.ok).toBe(true);
    });
  });

  describe('isSupportedProvider', () => {
    it('returns true for Google provider', () => {
      expect(isSupportedProvider(LlmProviders.Google)).toBe(true);
    });

    it('returns true for OpenRouter provider', () => {
      expect(isSupportedProvider(LlmProviders.OpenRouter)).toBe(true);
    });

    it('returns false for an unknown provider', () => {
      expect(isSupportedProvider('unknown-provider')).toBe(false);
    });

    it('returns true for Anthropic provider', () => {
      expect(isSupportedProvider(LlmProviders.Anthropic)).toBe(true);
    });

    it('returns true for OpenAI provider', () => {
      expect(isSupportedProvider(LlmProviders.OpenAI)).toBe(true);
    });

    it('returns true for Perplexity provider', () => {
      expect(isSupportedProvider(LlmProviders.Perplexity)).toBe(true);
    });

    it('returns false for unknown provider strings', () => {
      expect(isSupportedProvider('unknown')).toBe(false);
      expect(isSupportedProvider('')).toBe(false);
    });

    it('type narrows correctly for supported providers', () => {
      const provider = LlmProviders.Google as string;
      if (isSupportedProvider(provider)) {
        expect(
          provider === LlmProviders.Google ||
            provider === LlmProviders.Anthropic ||
            provider === LlmProviders.OpenAI ||
            provider === LlmProviders.Perplexity ||
            provider === LlmProviders.OpenRouter
        ).toBe(true);
      }
    });
  });

  describe('IntexuraOSError migration (INT-1564)', () => {
    it('createLlmClient throws IntexuraOSError(INVALID_REQUEST) for unknown model', () => {
      let captured: unknown;
      try {
        createLlmClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'made-up-model-id' as any,
          userId: 'user-123',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(IntexuraOSError);
      const err = captured as IntexuraOSError;
      expect(err.code).toBe('INVALID_REQUEST');
      expect(err.httpStatus).toBe(400);
      expect(err.message).toContain('made-up-model-id');
    });

    it('createToolCallingClient throws IntexuraOSError(INVALID_REQUEST) for unknown model', () => {
      let captured: unknown;
      try {
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: 'made-up-model-id' as any,
          userId: 'user-123',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(IntexuraOSError);
      const err = captured as IntexuraOSError;
      expect(err.code).toBe('INVALID_REQUEST');
      expect(err.httpStatus).toBe(400);
      expect(err.message).toContain('made-up-model-id');
    });

    it('createToolCallingClient throws IntexuraOSError(INVALID_REQUEST) for unsupported provider', () => {
      let captured: unknown;
      try {
        createToolCallingClient({
          apiKey: 'test-key',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: LlmModels.ClaudeOpus46 as any,
          userId: 'user-123',
          logger: mockLogger,
          usageSink: mockUsageSink,
        });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(IntexuraOSError);
      const err = captured as IntexuraOSError;
      expect(err.code).toBe('INVALID_REQUEST');
      expect(err.httpStatus).toBe(400);
      expect(err.message).toContain('anthropic');
    });
  });
});
