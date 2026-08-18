/**
 * Tests for llmFactory.
 *
 * Covers:
 * - executionMemoryEmbeddingClient is undefined when openaiAppApiKey=''
 * - executionMemoryEmbeddingClient is defined when openaiAppApiKey is set
 * - resolveToolCallingClient returns the user's Google key when user-service supplies one
 * - resolveToolCallingClient falls back to the platform Gemini key
 * - resolveToolCallingClient errors when no key is available
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import type { Logger } from 'pino';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createLlmServices } from '../../../services/factories/llmFactory.js';
import type { ServiceConfig } from '../../../services/types.js';

const { mockCreateToolCallingClient } = vi.hoisted(() => ({
  mockCreateToolCallingClient: vi.fn(() => ({ run: vi.fn() })),
}));

vi.mock('@intexuraos/llm-factory', () => ({
  createToolCallingClient: mockCreateToolCallingClient,
}));

const logger = pino({ level: 'silent' }) as unknown as Logger;

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    gcpProjectId: '', internalAuthToken: '', firestoreProjectId: '',
    whatsappServiceUrl: '', whatsappSendTopic: '', prTriageTopic: '',
    linearAgentUrl: '', webhookVerifySecret: '',
    orchestratorSecret: '', serviceUrl: '', codeTaskCallbackBaseUrl: '', webAppUrl: 'https://dev.intexuraos.cloud', userServiceUrl: '',
    openRouterAppApiKey: '', openaiAppApiKey: '', llmUsageServiceUrl: '',
    ...overrides,
  };
}

/** Produce a fake UserServiceClient whose getApiKeys returns the given OpenRouter key. */
function makeUserServiceClient(openRouterKey?: string, forceErr = false): UserServiceClient {
  return {
    getApiKeys: async (): Promise<Result<{ openrouter?: string }, { code: 'NO_API_KEY'; message: string }>> => {
      if (forceErr) return err({ code: 'NO_API_KEY' as const, message: 'fail' });
      return ok(openRouterKey !== undefined ? { openrouter: openRouterKey } : {});
    },
    getLlmClient: async () => err({ code: 'NO_API_KEY' as const, message: 'stub' }) as never,
    reportLlmSuccess: async () => undefined,
    getOAuthToken: async () => err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'stub' }),
    resolveGitHubUsername: async () => ok(null),
    getUserTimezone: async () => undefined,
  };
}

const buildUsageSink = (): HttpInternalAuthUsageSink => ({} as unknown as HttpInternalAuthUsageSink);

describe('createLlmServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executionMemoryEmbeddingClient', () => {
    it('is undefined when openaiAppApiKey is empty', () => {
      const services = createLlmServices({
        config: makeConfig(), logger,
        userServiceClient: makeUserServiceClient(), buildUsageSink,
      });
      expect(services.executionMemoryEmbeddingClient).toBeUndefined();
    });

    it('is defined when openaiAppApiKey is set', () => {
      const services = createLlmServices({
        config: makeConfig({ openaiAppApiKey: 'sk-test' }), logger,
        userServiceClient: makeUserServiceClient(), buildUsageSink,
      });
      expect(services.executionMemoryEmbeddingClient).toBeDefined();
    });

    describe('embedFn callback', () => {
      beforeEach(() => {
        nock.disableNetConnect();
      });

      afterEach(() => {
        nock.cleanAll();
        nock.enableNetConnect();
      });

      it('routes embed() calls through the configured OpenAI client', async () => {
        // Stub the OpenAI embeddings endpoint so the factory's embedFn
        // (llmFactory.ts) actually executes against a fake HTTP response.
        // This proves the factory wired embedFn to the configured OpenAI
        // client and not, say, a detached no-op closure.
        let capturedBody: unknown = null;
        const scope = nock('https://api.openai.com')
          .post('/v1/embeddings', (body) => {
            capturedBody = body;
            return true;
          })
          .reply(200, {
            object: 'list',
            model: 'text-embedding-3-small',
            usage: { prompt_tokens: 1, total_tokens: 1 },
            data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
          });

        const services = createLlmServices({
          config: makeConfig({ openaiAppApiKey: 'sk-test' }), logger,
          userServiceClient: makeUserServiceClient(), buildUsageSink,
        });
        const client = services.executionMemoryEmbeddingClient;
        expect(client).toBeDefined();
        if (client === undefined) return;

        await client.embed('hello world');

        // The request hit OpenAI — proves the factory's embedFn arrow body
        // (the call to `executionMemoryOpenAI.embeddings.create`) executed.
        expect(scope.isDone()).toBe(true);
        const body = capturedBody as { input?: string; model?: string } | null;
        expect(body?.input).toBe('hello world');
        expect(body?.model).toBe('text-embedding-3-small');
      });
    });
  });

  describe('resolveToolCallingClient', () => {
    it('uses the user OpenRouter key with Gemini 3.6 Flash when user-service returns one', async () => {
      const services = createLlmServices({
        config: makeConfig({ openRouterAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient('user-openrouter-key'), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
      expect(mockCreateToolCallingClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'user-openrouter-key',
          model: 'or:google/gemini-3.6-flash',
          userId: 'user-123',
        })
      );
    });

    it('falls back to platform OpenRouter key when user has no key', async () => {
      const services = createLlmServices({
        config: makeConfig({ openRouterAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient(undefined), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
      expect(mockCreateToolCallingClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'platform-key',
          model: 'or:google/gemini-3.6-flash',
          userId: 'user-123',
        })
      );
    });

    it('falls back to platform key when user-service errors', async () => {
      const services = createLlmServices({
        config: makeConfig({ openRouterAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient(undefined, true), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
    });

    it('returns LLM_FAILED error when no key is available anywhere', async () => {
      const services = createLlmServices({
        config: makeConfig({ openRouterAppApiKey: '' }), logger,
        userServiceClient: makeUserServiceClient(undefined), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_FAILED');
        expect(result.error.message).toContain('OpenRouter');
      }
    });
  });
});
