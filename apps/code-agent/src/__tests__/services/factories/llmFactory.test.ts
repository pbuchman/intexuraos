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

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Logger } from 'pino';
import { ok, err, type Result } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { HttpInternalAuthUsageSink } from '@intexuraos/llm-pricing';
import { createLlmServices } from '../../../services/factories/llmFactory.js';
import type { ServiceConfig } from '../../../services/types.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function makeConfig(overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    gcpProjectId: '', internalAuthToken: '', firestoreProjectId: '',
    whatsappServiceUrl: '', whatsappSendTopic: '', prTriageTopic: '',
    linearAgentUrl: '', actionsAgentUrl: '', webhookVerifySecret: '',
    orchestratorSecret: '', serviceUrl: '', userServiceUrl: '',
    geminiAppApiKey: '', openaiAppApiKey: '', llmUsageServiceUrl: '',
    ...overrides,
  };
}

/** Produce a fake UserServiceClient whose getApiKeys returns the given google key. */
function makeUserServiceClient(googleKey?: string, forceErr = false): UserServiceClient {
  return {
    getApiKeys: async (): Promise<Result<{ google?: string }, { code: 'NO_API_KEY'; message: string }>> => {
      if (forceErr) return err({ code: 'NO_API_KEY' as const, message: 'fail' });
      return ok(googleKey !== undefined ? { google: googleKey } : {});
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
  });

  describe('resolveToolCallingClient', () => {
    it('uses the user Google key when user-service returns one', async () => {
      const services = createLlmServices({
        config: makeConfig({ geminiAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient('user-google-key'), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
    });

    it('falls back to platform Gemini key when user has no key', async () => {
      const services = createLlmServices({
        config: makeConfig({ geminiAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient(undefined), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
    });

    it('falls back to platform key when user-service errors', async () => {
      const services = createLlmServices({
        config: makeConfig({ geminiAppApiKey: 'platform-key' }), logger,
        userServiceClient: makeUserServiceClient(undefined, true), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(true);
    });

    it('returns LLM_FAILED error when no key is available anywhere', async () => {
      const services = createLlmServices({
        config: makeConfig({ geminiAppApiKey: '' }), logger,
        userServiceClient: makeUserServiceClient(undefined), buildUsageSink,
      });
      const result = await services.resolveToolCallingClient('user-123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LLM_FAILED');
      }
    });
  });
});
