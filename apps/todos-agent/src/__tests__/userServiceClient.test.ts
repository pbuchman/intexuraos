import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { ok } from '@intexuraos/common-core';
import { LlmModels } from '@intexuraos/llm-contract';
import { createUserServiceClient } from '../infra/user/userServiceClient.js';
import { FakePricingContext } from '@intexuraos/llm-pricing';

vi.mock('@intexuraos/llm-factory', () => ({
  createLlmClient: vi.fn().mockImplementation((_config) => ({
    generate: vi.fn().mockResolvedValue(
      ok({
        content: 'test response',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costUsd: 0.0001 },
      })
    ),
  })),
}));

const USER_SERVICE_URL = 'http://localhost:8081';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';

function createClient(): ReturnType<typeof createUserServiceClient> {
  const pricingContext = new FakePricingContext();
  return createUserServiceClient({
    baseUrl: USER_SERVICE_URL,
    internalAuthToken: INTERNAL_AUTH_TOKEN,
    pricingContext,
  });
}

describe('UserServiceClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getGeminiApiKey (deprecated)', () => {
    it('returns the google API key on success', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' });

      const client = createClient();

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('google-api-key-123');
      }
    });

    it('returns NO_API_KEY error when google key is null', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-456/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: null });

      const client = createClient();

      const result = await client.getGeminiApiKey('user-456');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('User has not configured a Gemini API key');
      }
    });

    it('returns NO_API_KEY error when google key is undefined', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-789/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      const client = createClient();

      const result = await client.getGeminiApiKey('user-789');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toBe('User has not configured a Gemini API key');
      }
    });

    it('returns API_ERROR on HTTP 401 Unauthorized', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(401, { error: 'Unauthorized' });

      const client = createClient();

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 401');
      }
    });

    it('returns API_ERROR on HTTP 500 Internal Server Error', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(500, { error: 'Internal server error' });

      const client = createClient();

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .replyWithError('Connection refused');

      const client = createClient();

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('sends correct auth header', async () => {
      const pricingContext = new FakePricingContext();
      const scope = nock(USER_SERVICE_URL)
        .get('/internal/users/user-auth-test/llm-keys')
        .matchHeader('X-Internal-Auth', 'custom-token')
        .reply(200, { google: 'key' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: 'custom-token',
        pricingContext,
      });

      await client.getGeminiApiKey('user-auth-test');

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('getLlmClient', () => {
    it('returns a Gemini client when user has gemini-2.5-flash as default model', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' });

      const client = createClient();
      const result = await client.getLlmClient('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('returns a GLM client when user has glm-4.7 as default model', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-glm/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: 'glm-4.7',
          },
        });

      nock(USER_SERVICE_URL)
        .get('/internal/users/user-glm/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { zai: 'zai-api-key-123' });

      const client = createClient();
      const result = await client.getLlmClient('user-glm');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('defaults to gemini-2.5-flash when user has no llmPreferences', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-no-pref/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(USER_SERVICE_URL)
        .get('/internal/users/user-no-pref/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' });

      const client = createClient();
      const result = await client.getLlmClient('user-no-pref');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('returns NO_API_KEY error when user has no API key for their default model', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-no-key/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: 'glm-4.7',
          },
        });

      nock(USER_SERVICE_URL)
        .get('/internal/users/user-no-key/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' }); // No zai key

      const client = createClient();
      const result = await client.getLlmClient('user-no-key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('zai');
      }
    });

    it('returns API_ERROR on HTTP 401 when fetching settings', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-unauth/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(401, { error: 'Unauthorized' });

      const client = createClient();
      const result = await client.getLlmClient('user-unauth');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-network/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .replyWithError('Connection refused');

      const client = createClient();
      const result = await client.getLlmClient('user-network');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns API_ERROR on HTTP 401 when fetching keys', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-key-error/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(USER_SERVICE_URL)
        .get('/internal/users/user-key-error/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(401, { error: 'Unauthorized' });

      const client = createClient();
      const result = await client.getLlmClient('user-key-error');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
      }
    });

    it('returns INVALID_MODEL error when user has an invalid model preference', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-invalid-model/settings')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          llmPreferences: {
            defaultModel: 'not-a-real-model',
          },
        });

      const client = createClient();
      const result = await client.getLlmClient('user-invalid-model');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('Invalid model');
        expect(result.error.message).toContain('not-a-real-model');
      }
    });
  });
});
