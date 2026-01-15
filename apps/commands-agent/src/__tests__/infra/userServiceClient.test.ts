import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import type { Logger } from 'pino';
import { createPricingContext } from '@intexuraos/llm-pricing';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { createUserServiceClient } from '../../infra/user/index.js';

const INTEXURAOS_USER_SERVICE_URL = 'http://localhost:8081';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';

const createFakeLogger = (): Logger => pino({ level: 'silent' });

// Minimal pricing context for tests - structure matches AllPricingResponse
const testPricing = {
  [LlmProviders.Google]: {
    provider: LlmProviders.Google,
    updatedAt: '2025-01-01T00:00:00.000Z',
    models: {
      [LlmModels.Gemini25Flash]: {
        inputPricePerMillion: 0.075,
        outputPricePerMillion: 0.3,
      },
      [LlmModels.Gemini25Pro]: {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 5.0,
      },
    },
  },
  [LlmProviders.OpenAI]: { provider: LlmProviders.OpenAI, updatedAt: '2025-01-01T00:00:00.000Z', models: {} },
  [LlmProviders.Anthropic]: { provider: LlmProviders.Anthropic, updatedAt: '2025-01-01T00:00:00.000Z', models: {} },
  [LlmProviders.Perplexity]: { provider: LlmProviders.Perplexity, updatedAt: '2025-01-01T00:00:00.000Z', models: {} },
  [LlmProviders.Zai]: {
    provider: LlmProviders.Zai,
    updatedAt: '2025-01-01T00:00:00.000Z',
    models: {
      [LlmModels.Glm47]: {
        inputPricePerMillion: 0.5,
        outputPricePerMillion: 0.5,
      },
    },
  },
};
const pricingContext = createPricingContext(testPricing, [LlmModels.Gemini25Flash, LlmModels.Gemini25Pro, LlmModels.Glm47]);

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

  describe('getApiKeys', () => {
    it('returns google API key on success', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key', openai: null, anthropic: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBe('google-api-key');
      }
    });

    it('returns empty object when no google key exists', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: null, openai: 'some-key', anthropic: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBeUndefined();
      }
    });

    it('returns empty object when response has no keys', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-456/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-456');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBeUndefined();
      }
    });

    it('returns API_ERROR on HTTP 401', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(401, { error: 'Unauthorized' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns API_ERROR on HTTP 500', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns API_ERROR on HTTP 404', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/unknown-user/llm-keys')
        .reply(404, { error: 'Not found' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('unknown-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 404');
      }
    });

    it('returns API_ERROR without error details when body read fails', async () => {
      // Use empty body to trigger empty errorDetails path
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-empty-body/llm-keys')
        .reply(400, '');

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-empty-body');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 400');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .replyWithError('Connection refused');

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('sends correct auth header', async () => {
      const scope = nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-789/llm-keys')
        .matchHeader('X-Internal-Auth', 'custom-token')
        .reply(200, { google: 'key' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: 'custom-token',
        pricingContext,
        logger: createFakeLogger(),
      });

      await client.getApiKeys('user-789');

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('getLlmClient', () => {
    it('returns LLM client with user default model from settings', async () => {
      const userId = 'user-with-preference';
      const defaultModel = LlmModels.Gemini25Pro;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('uses default model when user has no preference', async () => {
      const userId = 'user-no-preference';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: {} });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(true);
    });

    it('uses default model when llmPreferences is missing', async () => {
      const userId = 'user-no-preferences-key';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(true);
    });

    it('returns INVALID_MODEL error for invalid model', async () => {
      const userId = 'user-invalid-model';
      const invalidModel = 'invalid-model-name';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: invalidModel } });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain(invalidModel);
      }
    });

    it('returns NO_API_KEY error when Google API key is null', async () => {
      const userId = 'user-no-key';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain(LlmProviders.Google);
      }
    });

    it('returns NO_API_KEY error when Google API key is undefined', async () => {
      const userId = 'user-missing-key';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns API_ERROR when settings endpoint fails', async () => {
      const userId = 'user-settings-error';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
      }
    });

    it('returns API_ERROR when keys endpoint fails', async () => {
      const userId = 'user-keys-error';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(500, { error: 'Database error' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      const userId = 'user-network-error';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .replyWithError('Connection refused');

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns LLM client for Zai (GLM) provider', async () => {
      const userId = 'user-zai-model';
      const glmModel = LlmModels.Glm47;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: glmModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { zai: 'zai-api-key-123' });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('returns NO_API_KEY error when Zai API key is null', async () => {
      const userId = 'user-no-zai-key';
      const glmModel = LlmModels.Glm47;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: glmModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { zai: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain(LlmProviders.Zai);
      }
    });

    it('returns NO_API_KEY error when OpenAI API key is null (provider key field mapping)', async () => {
      const userId = 'user-no-openai-key';
      // Note: OpenAI is not currently supported by llm-factory, but providerToKeyField should still work
      const openaiModel = LlmModels.GPT4oMini;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: openaiModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { openai: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain(LlmProviders.OpenAI);
      }
    });

    it('returns NO_API_KEY error when Anthropic API key is null (provider key field mapping)', async () => {
      const userId = 'user-no-anthropic-key';
      const claudeModel = LlmModels.ClaudeSonnet45;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: claudeModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { anthropic: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain(LlmProviders.Anthropic);
      }
    });

    it('returns NO_API_KEY error when Perplexity API key is null (provider key field mapping)', async () => {
      const userId = 'user-no-perplexity-key';
      const sonarModel = LlmModels.Sonar;

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { llmPreferences: { defaultModel: sonarModel } });

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { perplexity: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain(LlmProviders.Perplexity);
      }
    });

    it('returns NETWORK_ERROR when keys endpoint connection fails', async () => {
      const userId = 'user-keys-network-error';

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/settings`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      nock(INTEXURAOS_USER_SERVICE_URL)
        .get(`/internal/users/${userId}/llm-keys`)
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .replyWithError('Network timeout');

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
        pricingContext,
        logger: createFakeLogger(),
      });

      const result = await client.getLlmClient(userId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Network timeout');
      }
    });
  });
});
