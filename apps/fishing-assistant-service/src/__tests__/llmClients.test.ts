import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import { FakeUsageSink, type HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { OPENROUTER_TEXT_EMBEDDING_3_SMALL } from '@intexuraos/infra-openrouter';
import {
  createFixedGeminiFlashClient,
  FISHING_ASSISTANT_CHAT_MODEL_ID,
} from '../infra/llm/fixedGeminiFlashClient.js';
import { createOpenRouterKnowledgeEmbeddingClient } from '../infra/llm/embeddingClient.js';

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
    nock.disableNetConnect();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
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

  describe('createOpenRouterKnowledgeEmbeddingClient', () => {
    it('uses OpenRouter while preserving text-embedding-3-small semantics', async () => {
      const usageSink = new FakeUsageSink();
      let requestBody: unknown;
      nock('https://openrouter.ai')
        .post('/api/v1/embeddings', (body) => {
          requestBody = body;
          return true;
        })
        .reply(200, {
          data: [
            { index: 0, embedding: Array.from({ length: 1536 }, () => 0.1) },
            { index: 1, embedding: Array.from({ length: 1536 }, () => 0.2) },
          ],
          usage: { prompt_tokens: 4, total_tokens: 4, cost: 0.00002 },
        });

      const client = createOpenRouterKnowledgeEmbeddingClient({
        apiKey: 'or-platform-key',
        logger,
        usageSink,
      });
      const result = await client.embedTexts({
        userId: 'user-1',
        texts: ['pierwszy', 'drugi'],
      });

      expect(requestBody).toEqual({
        model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
        input: ['pierwszy', 'drugi'],
        dimensions: 1536,
        encoding_format: 'float',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error('Expected embedding success');
      }
      expect(result.value).toHaveLength(2);
      expect(result.value[0]).toHaveLength(1536);
      expect(usageSink.records[0]).toMatchObject({
        userId: 'user-1',
        callType: 'embedding',
        model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.evidenceModelId,
        promptType: 'fishing-knowledge-embedding',
      });
    });

    it('fails when OpenRouter returns an embedding with an unexpected dimension', async () => {
      nock('https://openrouter.ai')
        .post('/api/v1/embeddings')
        .reply(200, { data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] });

      const client = createOpenRouterKnowledgeEmbeddingClient({
        apiKey: 'or-platform-key',
        logger,
        usageSink: new FakeUsageSink(),
      });
      const result = await client.embedTexts({
        userId: 'user-1',
        texts: ['krótki test'],
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'EMBEDDING_FAILED',
          message: 'OpenRouter returned an invalid embedding response',
        },
      });
    });
  });
});
