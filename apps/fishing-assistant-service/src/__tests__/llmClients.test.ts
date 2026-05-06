import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import {
  createFixedGeminiFlashClient,
  FISHING_ASSISTANT_CHAT_MODEL_ID,
} from '../infra/llm/fixedGeminiFlashClient.js';
import { createOpenAiKnowledgeEmbeddingClient } from '../infra/llm/embeddingClient.js';

const { createLlmClientMock } = vi.hoisted(() => ({
  createLlmClientMock: vi.fn(),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: createLlmClientMock,
}));

const logger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('Fishing Assistant LLM clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createFixedGeminiFlashClient', () => {
    it('uses the user OpenRouter key with the fixed Gemini Flash model', async () => {
      const llmClient = { generate: vi.fn() } as unknown as LlmGenerateClient;
      createLlmClientMock.mockReturnValue(llmClient);
      const userServiceClient = {
        getApiKeys: vi.fn().mockResolvedValue({
          ok: true,
          value: { openrouter: 'or-key' },
        }),
      } as unknown as UserServiceClient;
      const usageSink = { log: vi.fn() } as unknown as HttpInternalAuthUsageSink;

      const adapter = createFixedGeminiFlashClient({
        userServiceClient,
        logger,
        usageSink,
      });
      const result = await adapter.createClientForUser('user-1');

      expect(result).toEqual({ ok: true, value: llmClient });
      expect(adapter.modelId).toBe(FISHING_ASSISTANT_CHAT_MODEL_ID);
      expect(userServiceClient.getApiKeys).toHaveBeenCalledWith('user-1');
      expect(createLlmClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'or-key',
          userId: 'user-1',
          logger,
          usageSink,
          ownerType: 'user',
        })
      );
    });

    it('returns NO_API_KEY when the user has no OpenRouter key', async () => {
      const userServiceClient = {
        getApiKeys: vi.fn().mockResolvedValue({
          ok: true,
          value: {},
        }),
      } as unknown as UserServiceClient;

      const adapter = createFixedGeminiFlashClient({
        userServiceClient,
        logger,
        usageSink: { log: vi.fn() } as unknown as HttpInternalAuthUsageSink,
      });
      const result = await adapter.createClientForUser('user-1');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'NO_API_KEY',
          message: 'OpenRouter API key is required for Fishing Assistant chat.',
        },
      });
      expect(createLlmClientMock).not.toHaveBeenCalled();
    });

    it('returns USER_KEYS_UNAVAILABLE when the key lookup fails', async () => {
      const userServiceClient = {
        getApiKeys: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'API_ERROR', message: 'keys unavailable' },
        }),
      } as unknown as UserServiceClient;

      const adapter = createFixedGeminiFlashClient({
        userServiceClient,
        logger,
        usageSink: { log: vi.fn() } as unknown as HttpInternalAuthUsageSink,
      });
      const result = await adapter.createClientForUser('user-1');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'USER_KEYS_UNAVAILABLE',
          message: 'keys unavailable',
        },
      });
      expect(createLlmClientMock).not.toHaveBeenCalled();
    });
  });

  describe('createOpenAiKnowledgeEmbeddingClient', () => {
    it('uses text-embedding-3-small and returns embeddings', async () => {
      const openAiClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [
              { embedding: Array.from({ length: 1536 }, () => 0.1) },
              { embedding: Array.from({ length: 1536 }, () => 0.2) },
            ],
          }),
        },
      };

      const client = createOpenAiKnowledgeEmbeddingClient({ openAiClient, logger });
      const result = await client.embedTexts({
        userId: 'user-1',
        texts: ['pierwszy', 'drugi'],
      });

      expect(openAiClient.embeddings.create).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['pierwszy', 'drugi'],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected embedding success');
      }
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toHaveLength(1536);
    });

    it('fails when OpenAI returns an embedding with an unexpected dimension', async () => {
      const openAiClient = {
        embeddings: {
          create: vi.fn().mockResolvedValue({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
        },
      };

      const client = createOpenAiKnowledgeEmbeddingClient({ openAiClient, logger });
      const result = await client.embedTexts({
        userId: 'user-1',
        texts: ['krótki test'],
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'EMBEDDING_FAILED',
          message: 'OpenAI returned an embedding with an unexpected dimension.',
        },
      });
    });
  });
});
