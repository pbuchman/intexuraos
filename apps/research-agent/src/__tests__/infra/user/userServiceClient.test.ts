/**
 * Tests for userServiceClient.
 */

import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { FakePricingContext } from '@intexuraos/llm-pricing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { createUserServiceClient, type UserServiceConfig } from '../../../infra/user/userServiceClient.js';

// Mock createLlmClient since the factory only supports Google and Zai providers
// but getLlmClient logic handles all providers
vi.mock('@intexuraos/llm-factory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intexuraos/llm-factory')>();
  return {
    ...actual,
    createLlmClient: vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue({ ok: true, value: { content: 'test' } }),
    }),
  };
});

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const createConfig = (overrides?: Partial<UserServiceConfig>): UserServiceConfig => ({
  baseUrl: 'http://user-service.local',
  internalAuthToken: 'test-token',
  pricingContext: new FakePricingContext(),
  logger: fakeLogger,
  ...overrides,
});

describe('createUserServiceClient', () => {
  const baseUrl = 'http://user-service.local';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getApiKeys', () => {
    it('returns API keys when successful', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          google: 'google-key',
          openai: 'openai-key',
          anthropic: 'anthropic-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getApiKeys('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBe('google-key');
        expect(result.value.openai).toBe('openai-key');
        expect(result.value.anthropic).toBe('anthropic-key');
      }
    });

    it('converts null values to undefined', async () => {
      nock(baseUrl).get('/internal/users/user-1/llm-keys').reply(200, {
        google: 'google-key',
        openai: null,
        anthropic: null,
      });

      const client = createUserServiceClient(createConfig());
      const result = await client.getApiKeys('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBe('google-key');
        expect(result.value.openai).toBeUndefined();
        expect(result.value.anthropic).toBeUndefined();
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(baseUrl).get('/internal/users/user-1/llm-keys').reply(500, { error: 'Internal error' });

      const client = createUserServiceClient(createConfig());
      const result = await client.getApiKeys('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl).get('/internal/users/user-1/llm-keys').replyWithError('Connection refused');

      const client = createUserServiceClient(createConfig());
      const result = await client.getApiKeys('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('reportLlmSuccess', () => {
    it('sends POST request to report success', async () => {
      const scope = nock(baseUrl)
        .post('/internal/users/user-1/llm-keys/google/last-used')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200);

      const client = createUserServiceClient(createConfig());
      await client.reportLlmSuccess('user-1', LlmProviders.Google);

      expect(scope.isDone()).toBe(true);
    });

    it('does not throw on network error (best effort)', async () => {
      nock(baseUrl)
        .post('/internal/users/user-1/llm-keys/openai/last-used')
        .replyWithError('Connection refused');

      const client = createUserServiceClient(createConfig());

      await expect(client.reportLlmSuccess('user-1', LlmProviders.OpenAI)).resolves.toBeUndefined();
    });

    it('does not throw on error response (best effort)', async () => {
      nock(baseUrl).post('/internal/users/user-1/llm-keys/anthropic/last-used').reply(500);

      const client = createUserServiceClient(createConfig());

      await expect(
        client.reportLlmSuccess('user-1', LlmProviders.Anthropic)
      ).resolves.toBeUndefined();
    });
  });

  describe('getLlmClient', () => {
    it('returns LLM client when successful with user default model', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          google: 'google-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(typeof result.value.generate).toBe('function');
      }
    });

    it('uses fallback model when user has no preference', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          // No llmPreferences
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          google: 'google-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', model: LlmModels.Gemini25Flash }),
        'LLM client created successfully'
      );
    });

    it('returns API_ERROR when settings fetch fails', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(500, { error: 'Internal error' });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns INVALID_MODEL when user has unsupported model preference', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: 'some-unsupported-model',
          },
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('Invalid model');
        expect(result.error.message).toContain('some-unsupported-model');
      }
    });

    it('returns API_ERROR when keys fetch fails', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(500, { error: 'Keys unavailable' });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns NO_API_KEY when user lacks key for their default model', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          // No google key
          openai: 'openai-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('No API key configured');
        expect(result.error.message).toContain('google');
      }
    });

    it('returns NO_API_KEY when API key is null', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          google: null,
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .replyWithError('Connection refused');

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('handles different provider models correctly (OpenAI)', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.GPT52,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          openai: 'openai-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ provider: LlmProviders.OpenAI }),
        'LLM client created successfully'
      );
    });

    it('handles different provider models correctly (Anthropic)', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.ClaudeSonnet45,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          anthropic: 'anthropic-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ provider: LlmProviders.Anthropic }),
        'LLM client created successfully'
      );
    });

    it('handles different provider models correctly (Perplexity)', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.SonarPro,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          perplexity: 'perplexity-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ provider: LlmProviders.Perplexity }),
        'LLM client created successfully'
      );
    });

    it('handles different provider models correctly (Zai)', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Glm47,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          zai: 'zai-api-key',
        });

      const client = createUserServiceClient(createConfig());
      const result = await client.getLlmClient('user-1');

      expect(result.ok).toBe(true);
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ provider: LlmProviders.Zai }),
        'LLM client created successfully'
      );
    });

    it('logs appropriate messages during the flow', async () => {
      nock(baseUrl)
        .get('/internal/users/user-1/settings')
        .reply(200, {
          llmPreferences: {
            defaultModel: LlmModels.Gemini25Flash,
          },
        });

      nock(baseUrl)
        .get('/internal/users/user-1/llm-keys')
        .reply(200, {
          google: 'google-api-key',
        });

      const client = createUserServiceClient(createConfig());
      await client.getLlmClient('user-1');

      expect(fakeLogger.info).toHaveBeenCalledWith(
        { userId: 'user-1' },
        'Creating LLM client for user'
      );
      expect(fakeLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', model: LlmModels.Gemini25Flash, provider: LlmProviders.Google }),
        'LLM client created successfully'
      );
    });
  });
});
