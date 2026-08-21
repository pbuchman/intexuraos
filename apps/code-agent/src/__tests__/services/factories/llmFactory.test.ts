/**
 * Tests for llmFactory.
 *
 * Covers:
 * - execution-memory embeddings use the platform OpenRouter key
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
import { FakeUsageSink, type HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { OPENROUTER_TEXT_EMBEDDING_3_SMALL } from '@intexuraos/infra-openrouter';
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
    linearAgentUrl: '',
    orchestratorSecret: '', serviceUrl: '', codeTaskCallbackBaseUrl: '', webAppUrl: 'https://dev.intexuraos.cloud', userServiceUrl: '',
    openRouterAppApiKey: '', llmUsageServiceUrl: '',
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

let usageSink: FakeUsageSink;
const buildUsageSink = (): HttpInternalAuthUsageSink =>
  usageSink as unknown as HttpInternalAuthUsageSink;

describe('createLlmServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usageSink = new FakeUsageSink();
  });

  describe('executionMemoryEmbeddingClient', () => {
    it('is undefined when openRouterAppApiKey is empty', () => {
      const services = createLlmServices({
        config: makeConfig(), logger,
        userServiceClient: makeUserServiceClient(), buildUsageSink,
      });
      expect(services.executionMemoryEmbeddingClient).toBeUndefined();
    });

    it('is defined when openRouterAppApiKey is set', () => {
      const services = createLlmServices({
        config: makeConfig({ openRouterAppApiKey: 'or-test' }), logger,
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

      it('routes embed() calls through OpenRouter and records canonical usage', async () => {
        let capturedBody: unknown = null;
        const scope = nock('https://openrouter.ai')
          .post('/api/v1/embeddings', (body) => {
            capturedBody = body;
            return true;
          })
          .reply(200, {
            object: 'list',
            model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId,
            usage: { prompt_tokens: 1, total_tokens: 1 },
            data: [{
              object: 'embedding',
              index: 0,
              embedding: Array.from(
                { length: OPENROUTER_TEXT_EMBEDDING_3_SMALL.dimensions },
                () => 0.1
              ),
            }],
          });

        const services = createLlmServices({
          config: makeConfig({ openRouterAppApiKey: 'or-test' }), logger,
          userServiceClient: makeUserServiceClient(), buildUsageSink,
        });
        const client = services.executionMemoryEmbeddingClient;
        expect(client).toBeDefined();
        if (client === undefined) return;

        await client.embed('hello world');

        expect(scope.isDone()).toBe(true);
        const body = capturedBody as { input?: string; model?: string; dimensions?: number } | null;
        expect(body?.input).toBe('hello world');
        expect(body?.model).toBe(OPENROUTER_TEXT_EMBEDDING_3_SMALL.apiModelId);
        expect(body?.dimensions).toBe(1536);
        expect(usageSink.records[0]).toMatchObject({
          callType: 'embedding',
          model: OPENROUTER_TEXT_EMBEDDING_3_SMALL.evidenceModelId,
          provider: 'openrouter',
        });
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
