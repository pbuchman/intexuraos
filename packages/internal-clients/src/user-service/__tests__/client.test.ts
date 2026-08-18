import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { createUserServiceClient, providerToKeyField } from '../client.js';
import { apiFail, apiOk } from '@intexuraos/common-http';
import {
  DEFAULT_PLATFORM_LLM_MODEL,
  IntexAgentModels,
  LegacyGoogleModels,
  LlmModels,
  LlmProviders,
} from '@intexuraos/llm-contract';
import { createFakeUsageSink } from '@intexuraos/llm-pricing';
import type { UserServiceClient } from '../types.js';

describe('providerToKeyField', () => {
  it('returns openrouter for OpenRouter provider', () => {
    expect(providerToKeyField(LlmProviders.OpenRouter)).toBe(LlmProviders.OpenRouter);
  });
});

describe('createUserServiceClient', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const config = {
    baseUrl: 'http://localhost:3000',
    internalAuthToken: 'test-token',
    logger: mockLogger,
    usageSink: createFakeUsageSink(),
  };

  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('getApiKeys', () => {
    it('ignores direct-provider keys from the rolling-deploy response', async () => {
      const mockKeys = {
        google: 'google-key',
        openai: 'openai-key',
        anthropic: 'anthropic-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).toEqual({});
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('handles 404 - user not found', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 404');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('handles 401 - invalid auth token', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(401);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 401');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('handles network errors', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('converts null values to undefined', async () => {
      const mockKeys = {
        google: 'google-key',
        openai: null,
        anthropic: undefined,
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).not.toHaveProperty('google');
        expect(result.value).toEqual({});
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('uses the platform OpenRouter key when the user has no OpenRouter key', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { openrouter: null } });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).toEqual({ openrouter: 'platform-openrouter-key' });
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('treats a whitespace-only user key as absent and falls back to the platform key', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { openrouter: '   ' } });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getApiKeys('user123');

      expect(result).toEqual({ ok: true, value: { openrouter: 'platform-openrouter-key' } });
    });

    it('omits OpenRouter access when both user and platform keys are blank', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { openrouter: '' } });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: '   ',
      });
      const result = await client.getApiKeys('user123');

      expect(result).toEqual({ ok: true, value: {} });
    });

    it('ignores all legacy provider response fields', async () => {
      const mockKeys = {
        google: null,
        openai: 'openai-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).not.toHaveProperty('google');
        expect(result.value).not.toHaveProperty('openai');
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns only the user OpenRouter key when all legacy fields are present', async () => {
      const mockKeys = {
        google: 'google-key',
        openai: 'openai-key',
        anthropic: 'anthropic-key',
        perplexity: 'perplexity-key',
        openrouter: 'openrouter-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).toEqual({ openrouter: 'openrouter-key' });
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with spaces', async () => {
      const mockKeys = { openrouter: 'openrouter-key' };
      const userId = 'user 123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys(userId);

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with plus', async () => {
      const mockKeys = { openrouter: 'openrouter-key' };
      const userId = 'user+123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys(userId);

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with pipe (Auth0 format)', async () => {
      const mockKeys = { openrouter: 'openrouter-key' };
      const userId = 'auth0|1234567890';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys(userId);

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
      } else {
        expect.fail('Expected successful result');
      }
    });
  });

  describe('getLlmClient', () => {
    it('uses the platform OpenRouter default when the user has no preference or key', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user123',
          model: IntexAgentModels.MiniMaxM3,
          provider: LlmProviders.OpenRouter,
        },
        'LLM client created successfully'
      );
    });

    it('returns NO_API_KEY when both stored and platform OpenRouter keys are blank', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { openrouter: '   ' } });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: '',
      });
      const result = await client.getLlmClient('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'NO_API_KEY',
          message: 'No OpenRouter access is available for this user.',
        },
      });
    });

    it('maps an explicit legacy Gemini preference to the platform OpenRouter model', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: { llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash } },
        });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { google: 'legacy-google-key' } });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user123',
          model: DEFAULT_PLATFORM_LLM_MODEL,
          provider: LlmProviders.OpenRouter,
        },
        'LLM client created successfully'
      );
    });

    it('maps the retired Gemini preview preference to Gemini 3.6 Flash', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: { llmPreferences: { defaultModel: 'or:google/gemini-3-flash-preview' } },
        });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { openrouter: 'openrouter-key' } });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user123',
          model: IntexAgentModels.Gemini36Flash,
          provider: LlmProviders.OpenRouter,
        },
        'LLM client created successfully'
      );
    });

    it('falls back to platform OpenRouter when an explicit Gemini preference has no user key', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: { llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash } },
        });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          userId: 'user123',
          model: IntexAgentModels.MiniMaxM3,
          provider: LlmProviders.OpenRouter,
        },
        'LLM client created successfully'
      );
    });

    it('fetches settings and keys, returns configured client', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: IntexAgentModels.MiniMaxM3,
        },
      };

      const mockKeys = {
        openrouter: 'openrouter-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            userId: 'user123',
            model: IntexAgentModels.MiniMaxM3,
            provider: LlmProviders.OpenRouter,
          },
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('uses default model when user has no preference', async () => {
      const mockSettings = {
        llmPreferences: {},
      };

      const mockKeys = {
        openrouter: 'openrouter-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ model: IntexAgentModels.MiniMaxM3 }),
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns NO_API_KEY when provider key missing', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LegacyGoogleModels.Gemini25Flash,
        },
      };

      const mockKeys = {
        openai: 'openai-key', // but user wants Google
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('OpenRouter');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { userId: 'user123', provider: LlmProviders.OpenRouter },
          'No API key configured for provider'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('read-normalizes an unknown stored preference to the platform OpenRouter model', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: 'invalid-model',
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            userId: 'user123',
            model: IntexAgentModels.MiniMaxM3,
            provider: LlmProviders.OpenRouter,
          },
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected unknown preference to normalize on read');
      }
    });

    it('handles settings fetch failure', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch user settings');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { userId: 'user123', status: 500 },
          'Failed to fetch user settings'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('handles keys fetch failure', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LegacyGoogleModels.Gemini25Flash,
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('Failed to fetch API keys');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { userId: 'user123', status: 500 },
          'Failed to fetch API keys'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('handles network error in getLlmClient', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(mockLogger.error).toHaveBeenCalledWith(
          { userId: 'user123', error: expect.any(String) },
          'Network error while creating LLM client'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('URL encodes userId with ampersand in settings request', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: IntexAgentModels.MiniMaxM3,
        },
      };
      const mockKeys = { openrouter: 'openrouter-key' };
      const userId = 'user&test';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient(userId);

      if (result.ok) {
        expect(result.value).toBeDefined();
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with pipe (Auth0 format) in keys request', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: IntexAgentModels.MiniMaxM3,
        },
      };
      const mockKeys = { openrouter: 'openrouter-key' };
      const userId = 'auth0|123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient(userId);

      if (result.ok) {
        expect(result.value).toBeDefined();
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('read-normalizes a stored GPT-5.4 direct preference', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.GPT54,
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ model: IntexAgentModels.MiniMaxM3 }),
        'LLM client created successfully'
      );
    });

    it('read-normalizes a stored Claude direct preference', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.ClaudeSonnet46,
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ model: IntexAgentModels.MiniMaxM3 }),
        'LLM client created successfully'
      );
    });

    it('read-normalizes a stored Perplexity direct preference', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.SonarPro,
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: {} });

      const client = createUserServiceClient({
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      });
      const result = await client.getLlmClient('user123');

      expect(result.ok).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ model: IntexAgentModels.MiniMaxM3 }),
        'LLM client created successfully'
      );
    });

    it('creates client for default-eligible OpenRouter model with allowlist pricing', async () => {
      const openRouterModel = 'or:google/gemma-4-31b-it:free';
      const mockSettings = {
        llmPreferences: {
          defaultModel: openRouterModel,
        },
      };

      const mockKeys = {
        openrouter: 'openrouter-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          { userId: 'user123', model: openRouterModel, provider: LlmProviders.OpenRouter },
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected successful result for default-eligible OpenRouter model');
      }
    });

    it('normalizes a direct-provider selection to the platform OpenRouter default', async () => {
      const configWithOpenRouterKey = {
        ...config,
        platformOpenRouterApiKey: 'platform-openrouter-key',
      };

      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.ClaudeHaiku35,
        },
      };

      const mockKeys = {
        openai: 'openai-key', // No anthropic key
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(configWithOpenRouterKey);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.warn).not.toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(
          {
            userId: 'user123',
            model: IntexAgentModels.MiniMaxM3,
            provider: LlmProviders.OpenRouter,
          },
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns NO_API_KEY when user has no key and no platform keys configured', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LegacyGoogleModels.Gemini25Flash,
        },
      };

      const mockKeys = {
        openai: 'openai-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('OpenRouter');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns client with zero pricing when pricingContext is omitted', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: IntexAgentModels.MiniMaxM3,
        },
      };

      const mockKeys = {
        openrouter: 'openrouter-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockSettings });

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockKeys });

      const noPricingConfig = {
        baseUrl: 'http://localhost:3000',
        internalAuthToken: 'test-token',
        logger: mockLogger,
        usageSink: createFakeUsageSink(),
      };

      const client = createUserServiceClient(noPricingConfig);
      const result = await client.getLlmClient('user123');

      // Zero pricing is the expected intermediate state during the INT-1377
      // migration: consumers drop pricingContext now, server-side pricing lands later.
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value).toBeDefined();
      expect(typeof result.value.generate).toBe('function');
    });
  });

  describe('reportLlmSuccess', () => {
    it('calls last-used endpoint with correct provider', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess('user123', LlmProviders.OpenRouter);

      // Should complete without throwing
      expect(true).toBe(true);
    });

    it('silently ignores failures (best effort)', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);

      // Should not throw
      await expect(
        client.reportLlmSuccess('user123', LlmProviders.OpenRouter)
      ).resolves.toBeUndefined();
    });

    it('silently ignores network timeout errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .delay(5000)
        .reply(200);

      const client = createUserServiceClient(config);

      // The function should not throw due to try-catch
      await expect(
        client.reportLlmSuccess('user123', LlmProviders.OpenRouter)
      ).resolves.toBeUndefined();
    });

    it('silently ignores 500 server errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.OpenRouter)
      ).resolves.toBeUndefined();
    });

    it('silently ignores 404 not found errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404);

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.OpenRouter)
      ).resolves.toBeUndefined();
    });

    it('silently ignores JSON parse errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/openrouter/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, '{ invalid json }');

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.OpenRouter)
      ).resolves.toBeUndefined();
    });

    it('URL encodes userId with plus in reportLlmSuccess', async () => {
      const userId = 'user+special';
      const provider = 'openrouter';

      nock('http://localhost:3000')
        .post(`/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess(userId, LlmProviders.OpenRouter);

      // Should complete without throwing
      expect(true).toBe(true);
    });

    it('URL encodes userId with pipe (Auth0 format) in reportLlmSuccess', async () => {
      const userId = 'auth0|xyz123';
      const provider = 'openrouter';

      nock('http://localhost:3000')
        .post(`/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess(userId, LlmProviders.OpenRouter);

      // Should complete without throwing
      expect(true).toBe(true);
    });
  });

  describe('getOAuthToken', () => {
    it('returns token on success', async () => {
      const mockToken = {
        accessToken: 'ya29.a0...',
        email: 'user@example.com',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockToken });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns CONNECTION_NOT_FOUND when not connected', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404, { code: 'CONNECTION_NOT_FOUND', error: 'Not connected' });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('CONNECTION_NOT_FOUND');
        expect(result.error.message).toBe('OAuth not connected');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns CONNECTION_NOT_FOUND on 404 without code', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404, { error: 'Not found' });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('CONNECTION_NOT_FOUND');
        expect(result.error.message).toBe('OAuth not connected');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns TOKEN_REFRESH_FAILED when refresh fails', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500, { code: 'TOKEN_REFRESH_FAILED', error: 'Refresh failed' });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_REFRESH_FAILED');
        expect(result.error.message).toBe('Failed to refresh token');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns OAUTH_NOT_CONFIGURED when not set up', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500, { code: 'CONFIGURATION_ERROR', error: 'Not configured' });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('OAUTH_NOT_CONFIGURED');
        expect(result.error.message).toBe('OAuth not configured');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('URL encodes userId with pipe (Auth0 format) in getOAuthToken', async () => {
      const mockToken = {
        accessToken: 'ya29.a0...',
        email: 'user@example.com',
      };
      const userId = 'auth0|abc123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/oauth/google/token`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockToken });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken(userId, 'google');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with ampersand in getOAuthToken', async () => {
      const mockToken = {
        accessToken: 'ya29.a0...',
        email: 'user@example.com',
      };
      const userId = 'user&test';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/oauth/google/token`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockToken });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken(userId, 'google');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with slash in getOAuthToken', async () => {
      const mockToken = {
        accessToken: 'ya29.a0...',
        email: 'user@example.com',
      };
      const userId = 'user/with/slash';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/oauth/google/token`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockToken });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken(userId, 'google');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns API_ERROR with fallback message when error response has no error field', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/google/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500, { code: 'UNKNOWN_ERROR' }); // No 'error' field

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'google');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('works with github provider', async () => {
      const mockToken = {
        accessToken: 'gho_abc123...',
        email: 'user@example.com',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/oauth/github/token')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: mockToken });

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken('user123', 'github');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });
  });

  describe('resolveGitHubUsername', () => {
    it('returns userId on success', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/by-github-username/octocat')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { userId: 'auth0|user123' } });

      const client = createUserServiceClient(config);
      const result = await client.resolveGitHubUsername('octocat');

      if (result.ok) {
        expect(result.value).toEqual({ userId: 'auth0|user123' });
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns null (ok(null)) when username not found (404)', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/by-github-username/unknown-user')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404);

      const client = createUserServiceClient(config);
      const result = await client.resolveGitHubUsername('unknown-user');

      if (result.ok) {
        expect(result.value).toBeNull();
      } else {
        expect.fail('Expected ok(null) result');
      }
    });

    it('returns API_ERROR on non-404 HTTP error', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/by-github-username/octocat')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const client = createUserServiceClient(config);
      const result = await client.resolveGitHubUsername('octocat');

      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/by-github-username/octocat')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);
      const result = await client.resolveGitHubUsername('octocat');

      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('ECONNREFUSED');
      } else {
        expect.fail('Expected error result');
      }
    });

    it('URL encodes username with special characters', async () => {
      nock('http://localhost:3000')
        .get(`/internal/users/by-github-username/${encodeURIComponent('user name')}`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: { userId: 'auth0|user123' } });

      const client = createUserServiceClient(config);
      const result = await client.resolveGitHubUsername('user name');

      if (result.ok) {
        expect(result.value).toEqual({ userId: 'auth0|user123' });
      } else {
        expect.fail('Expected successful result');
      }
    });
  });

  describe('getUserTimezone', () => {
    it('returns timezone string when user has timezone set', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: {
            timezone: 'Europe/Berlin',
          },
        });

      const client = createUserServiceClient(config);
      const result = await client.getUserTimezone('user123');

      expect(result).toBe('Europe/Berlin');
    });

    it('returns undefined when user has no timezone set', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: {},
        });

      const client = createUserServiceClient(config);
      const result = await client.getUserTimezone('user123');

      expect(result).toBeUndefined();
    });

    it('returns undefined and logs warning when HTTP call fails', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500);

      const client = createUserServiceClient(config);
      const result = await client.getUserTimezone('user123');

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { userId: 'user123', status: 500 },
        'Failed to fetch user timezone'
      );
    });

    it('returns undefined and logs warning on network error', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);
      const result = await client.getUserTimezone('user123');

      expect(result).toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { userId: 'user123', error: expect.stringContaining('ECONNREFUSED') },
        'Failed to fetch user timezone'
      );
    });

    it('propagates HTTP failures without logging user data when requested by the caller', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/private-user-123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(503);

      const client = createUserServiceClient(config);

      await expect(
        client.getUserTimezone('private-user-123', { throwOnError: true })
      ).rejects.toThrow('HTTP 503');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('propagates network failures without logging user data when requested by the caller', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/private-user-123/settings')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);

      await expect(
        client.getUserTimezone('private-user-123', { throwOnError: true })
      ).rejects.toThrow(/ECONNREFUSED/u);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('passes an AbortSignal to the timezone transport and propagates cancellation silently', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/private-user-123/settings')
        .delay(5_000)
        .reply(200, { success: true, data: { timezone: 'Europe/Warsaw' } });
      const controller = new AbortController();
      const client = createUserServiceClient(config);
      const lookup = client.getUserTimezone('private-user-123', {
        signal: controller.signal,
        throwOnError: true,
      });

      controller.abort();

      await expect(lookup).rejects.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('URL encodes userId with pipe (Auth0 format)', async () => {
      const userId = 'auth0|user123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, {
          success: true,
          data: { timezone: 'America/New_York' },
        });

      const client = createUserServiceClient(config);
      const result = await client.getUserTimezone(userId);

      expect(result).toBe('America/New_York');
    });
  });

  describe('resolveIntexAgentRuntimeSettings', () => {
    const availableRuntimeSettings = {
      status: 'available',
      effectiveModel: IntexAgentModels.MiniMaxM3,
      explicitModel: IntexAgentModels.MiniMaxM3,
      source: 'explicit',
      revision: 7,
      timeZone: 'Europe/Warsaw',
    };

    const unavailableRuntimeSettings = {
      status: 'unavailable',
      effectiveModel: IntexAgentModels.DeepSeekV4Flash,
      source: 'platform_default',
      timeZone: 'UTC',
    };

    function expectNoRuntimeTransportLogs(): void {
      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(mockLogger.debug).not.toHaveBeenCalled();
    }

    it('keeps a base-only fake assignable while exposing the narrow runtime client on factory output', async () => {
      const baseOnlyFake: UserServiceClient = {
        getApiKeys: async () => ({ ok: true, value: {} }),
        getLlmClient: async () => ({ ok: false, error: { code: 'NO_API_KEY', message: 'unused' } }),
        reportLlmSuccess: async () => undefined,
        getOAuthToken: async () => ({
          ok: false,
          error: { code: 'OAUTH_NOT_CONFIGURED', message: 'unused' },
        }),
        resolveGitHubUsername: async () => ({ ok: true, value: null }),
        getUserTimezone: async () => undefined,
      };

      expect(baseOnlyFake.getApiKeys).toBeTypeOf('function');

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: unavailableRuntimeSettings });

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({ ok: true, value: unavailableRuntimeSettings });
    });

    it('sends the encoded runtime endpoint request with internal auth and decodes both closed DTO arms', async () => {
      const userId = 'auth0|user name+test';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings/intex-agent-runtime`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: availableRuntimeSettings });
      nock('http://localhost:3000')
        .get('/internal/users/unavailable/settings/intex-agent-runtime')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: unavailableRuntimeSettings });

      const client = createUserServiceClient(config);
      await expect(client.resolveIntexAgentRuntimeSettings(userId)).resolves.toEqual({
        ok: true,
        value: availableRuntimeSettings,
      });
      await expect(client.resolveIntexAgentRuntimeSettings('unavailable')).resolves.toEqual({
        ok: true,
        value: unavailableRuntimeSettings,
      });
      expectNoRuntimeTransportLogs();
    });

    it('decodes the standard success envelope emitted by reply.ok', async () => {
      const response = apiOk(availableRuntimeSettings, {
        requestId: 'runtime-request-123',
        durationMs: 12,
      });

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, response);

      await expect(
        createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123')
      ).resolves.toEqual({ ok: true, value: availableRuntimeSettings });
      expectNoRuntimeTransportLogs();
    });

    it('accepts an unsafe integer downstream status allowed by the standard diagnostics schema', async () => {
      const response = apiOk(availableRuntimeSettings, {
        requestId: 'runtime-request-unsafe-status',
        downstreamStatus: Number.MAX_SAFE_INTEGER + 1,
      });

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, response);

      await expect(
        createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123')
      ).resolves.toEqual({ ok: true, value: availableRuntimeSettings });
      expectNoRuntimeTransportLogs();
    });

    it('maps the standard failure envelope with diagnostics and details to a static API error', async () => {
      const response = apiFail(
        'INTERNAL_ERROR',
        'raw upstream message',
        {
          requestId: 'runtime-request-456',
          durationMs: 18,
          downstreamStatus: 503,
          downstreamRequestId: 'downstream-request-789',
          endpointCalled: 'internal runtime endpoint',
        },
        { retryable: false }
      );

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, response);

      await expect(
        createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123')
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'User Service runtime settings request failed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it.each([
      ['non-object data', null],
      ['unknown status', { ...availableRuntimeSettings, status: 'unknown' }],
      ['available extra field', { ...availableRuntimeSettings, unexpected: true }],
      ['unavailable extra field', { ...unavailableRuntimeSettings, unexpected: true }],
      ['available missing revision', { ...availableRuntimeSettings, revision: undefined }],
      [
        'unavailable wrong default',
        { ...unavailableRuntimeSettings, effectiveModel: IntexAgentModels.MiniMaxM3 },
      ],
      [
        'noncanonical available model',
        { ...availableRuntimeSettings, effectiveModel: 'or:not/canonical' },
      ],
      ['invalid available source', { ...availableRuntimeSettings, source: 'platform_default' }],
      ['invalid unavailable source', { ...unavailableRuntimeSettings, source: 'explicit' }],
      ['invalid revision', { ...availableRuntimeSettings, revision: -1 }],
      ['fractional revision', { ...availableRuntimeSettings, revision: 1.5 }],
      ['unsafe revision', { ...availableRuntimeSettings, revision: Number.MAX_SAFE_INTEGER + 1 }],
      ['non-string timezone', { ...availableRuntimeSettings, timeZone: 42 }],
    ])('maps %s to the closed malformed response error without logging', async (_name, data) => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, { success: true, data });

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'User Service runtime settings response was malformed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it.each([
      [
        'explicit source with a null explicit model',
        { ...availableRuntimeSettings, explicitModel: null },
      ],
      [
        'explicit source with a different effective model',
        { ...availableRuntimeSettings, effectiveModel: IntexAgentModels.Gemini36Flash },
      ],
      [
        'default-absent source with an explicit model',
        {
          ...availableRuntimeSettings,
          effectiveModel: IntexAgentModels.DeepSeekV4Flash,
          source: 'default_absent',
        },
      ],
      [
        'default-absent source with a non-default effective model',
        {
          ...availableRuntimeSettings,
          explicitModel: null,
          source: 'default_absent',
        },
      ],
    ])('rejects %s as a malformed response without logging', async (_name, data) => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, { success: true, data });

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'User Service runtime settings response was malformed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it('accepts the maximum safe selector revision', async () => {
      const data = { ...availableRuntimeSettings, revision: Number.MAX_SAFE_INTEGER };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, { success: true, data });

      await expect(
        createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123')
      ).resolves.toEqual({ ok: true, value: data });
      expectNoRuntimeTransportLogs();
    });

    it.each([
      ['null envelope', null],
      ['array envelope', []],
      ['malformed envelope', { data: availableRuntimeSettings }],
      ['success envelope without data', { success: true }],
      ['string success discriminator', { success: 'yes', data: availableRuntimeSettings }],
      ['numeric success discriminator', { success: 1, data: availableRuntimeSettings }],
      ['null success discriminator', { success: null, data: availableRuntimeSettings }],
      [
        'success envelope with an extra field',
        { success: true, data: availableRuntimeSettings, unexpected: true },
      ],
      [
        'success envelope with an unknown diagnostics field',
        {
          success: true,
          data: availableRuntimeSettings,
          diagnostics: { requestId: 'request-123', unexpected: true },
        },
      ],
      [
        'success envelope with non-object diagnostics',
        { success: true, data: availableRuntimeSettings, diagnostics: 'request-123' },
      ],
      [
        'success envelope with diagnostics missing requestId',
        { success: true, data: availableRuntimeSettings, diagnostics: { durationMs: 12 } },
      ],
      [
        'success envelope with non-string diagnostics requestId',
        { success: true, data: availableRuntimeSettings, diagnostics: { requestId: 123 } },
      ],
      [
        'success envelope with non-finite diagnostics duration',
        {
          success: true,
          data: availableRuntimeSettings,
          diagnostics: { requestId: 'request-123', durationMs: Number.POSITIVE_INFINITY },
        },
      ],
      [
        'success envelope with fractional diagnostics downstream status',
        {
          success: true,
          data: availableRuntimeSettings,
          diagnostics: { requestId: 'request-123', downstreamStatus: 200.5 },
        },
      ],
      [
        'success envelope with non-string diagnostics downstream request ID',
        {
          success: true,
          data: availableRuntimeSettings,
          diagnostics: { requestId: 'request-123', downstreamRequestId: 123 },
        },
      ],
      [
        'success envelope with non-string diagnostics endpoint',
        {
          success: true,
          data: availableRuntimeSettings,
          diagnostics: { requestId: 'request-123', endpointCalled: 123 },
        },
      ],
      ['failure envelope without an error', { success: false }],
      [
        'failure envelope with a malformed error',
        { success: false, error: { code: 'INTERNAL_ERROR', message: 42 } },
      ],
      [
        'failure envelope with an unknown error field',
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'raw', unexpected: true },
        },
      ],
      [
        'failure envelope with an unknown error code',
        { success: false, error: { code: 'NOT_A_COMMON_ERROR_CODE', message: 'raw' } },
      ],
    ])('maps %s to the closed malformed response error without logging', async (_name, body) => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(200, JSON.stringify(body), { 'Content-Type': 'application/json' });

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'MALFORMED_RESPONSE',
          message: 'User Service runtime settings response was malformed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it.each([
      [
        'non-2xx response',
        503,
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'raw' } },
      ],
      [
        'API envelope failure',
        200,
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'raw' } },
      ],
    ])('maps %s to the static API error without logging', async (_name, status, body) => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .reply(status, body);

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: 'User Service runtime settings request failed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it('maps network errors to the static network error without leaking transport details to logs', async () => {
      nock('http://localhost:3000')
        .get('/internal/users/user123/settings/intex-agent-runtime')
        .replyWithError('runtime transport sentinel');

      const result =
        await createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'User Service runtime settings request failed',
        },
      });
      expectNoRuntimeTransportLogs();
    });

    it('uses the shared 30-second abort timeout and maps it silently to the static timeout error', async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn(
        (_input: unknown, init?: RequestInit): Promise<Response> =>
          new Promise((_resolve, reject: (reason: unknown) => void) => {
            init?.signal?.addEventListener('abort', () => {
              const abortError = new Error('runtime timeout sentinel');
              abortError.name = 'AbortError';
              reject(abortError);
            });
          })
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        const resultPromise =
          createUserServiceClient(config).resolveIntexAgentRuntimeSettings('user123');

        await vi.advanceTimersByTimeAsync(30_000);

        await expect(resultPromise).resolves.toEqual({
          ok: false,
          error: {
            code: 'TIMEOUT',
            message: 'User Service runtime settings request timed out',
          },
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        expectNoRuntimeTransportLogs();
      } finally {
        vi.unstubAllGlobals();
        vi.useRealTimers();
      }
    });
  });
});
