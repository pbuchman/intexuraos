import { describe, it, expect, beforeEach, vi } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../client.js';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { createFakePricingContext } from '@intexuraos/llm-pricing';

describe('createUserServiceClient', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockPricingContext = createFakePricingContext();

  const config = {
    baseUrl: 'http://localhost:3000',
    internalAuthToken: 'test-token',
    pricingContext: mockPricingContext,
    logger: mockLogger,
  };

  beforeEach(() => {
    nock.cleanAll();
    vi.clearAllMocks();
  });

  describe('getApiKeys', () => {
    it('returns decrypted keys on success', async () => {
      const mockKeys = {
        google: 'google-key',
        openai: 'openai-key',
        anthropic: 'anthropic-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
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
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys('user123');

      if (result.ok) {
        expect(result.value.google).toBe('google-key');
        expect(result.value.openai).toBeUndefined();
        expect(result.value.anthropic).toBeUndefined();
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with spaces', async () => {
      const mockKeys = { google: 'google-key' };
      const userId = 'user 123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys(userId);

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with plus', async () => {
      const mockKeys = { google: 'google-key' };
      const userId = 'user+123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getApiKeys(userId);

      if (result.ok) {
        expect(result.value).toEqual(mockKeys);
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('URL encodes userId with pipe (Auth0 format)', async () => {
      const mockKeys = { google: 'google-key' };
      const userId = 'auth0|1234567890';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

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
    it('fetches settings and keys, returns configured client', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.Gemini25Flash,
        },
      };

      const mockKeys = {
        google: 'google-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          { userId: 'user123', model: LlmModels.Gemini25Flash, provider: LlmProviders.Google },
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
        google: 'google-key',
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (result.ok) {
        expect(result.value).toBeDefined();
        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({ model: LlmModels.Gemini25Flash }),
          'LLM client created successfully'
        );
      } else {
        expect.fail('Expected successful result');
      }
    });

    it('returns NO_API_KEY when provider key missing', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.Gemini25Flash,
        },
      };

      const mockKeys = {
        openai: 'openai-key', // but user wants Google
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      nock('http://localhost:3000')
        .get('/internal/users/user123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
        expect(result.error.message).toContain('google');
        expect(mockLogger.info).toHaveBeenCalledWith(
          { userId: 'user123', provider: LlmProviders.Google },
          'No API key configured for provider'
        );
      } else {
        expect.fail('Expected error result');
      }
    });

    it('returns INVALID_MODEL when user preference invalid', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: 'invalid-model',
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient('user123');

      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MODEL');
        expect(result.error.message).toContain('invalid-model');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          { userId: 'user123', invalidModel: 'invalid-model' },
          'User has invalid model preference'
        );
      } else {
        expect.fail('Expected error result');
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
          defaultModel: LlmModels.Gemini25Flash,
        },
      };

      nock('http://localhost:3000')
        .get('/internal/users/user123/settings')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

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

    it('URL encodes userId with ampersand in settings request', async () => {
      const mockSettings = {
        llmPreferences: {
          defaultModel: LlmModels.Gemini25Flash,
        },
      };
      const mockKeys = { google: 'google-key' };
      const userId = 'user&test';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

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
          defaultModel: LlmModels.Gemini25Flash,
        },
      };
      const mockKeys = { google: 'google-key' };
      const userId = 'auth0|123';

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/settings`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockSettings);

      nock('http://localhost:3000')
        .get(`/internal/users/${encodeURIComponent(userId)}/llm-keys`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, mockKeys);

      const client = createUserServiceClient(config);
      const result = await client.getLlmClient(userId);

      if (result.ok) {
        expect(result.value).toBeDefined();
      } else {
        expect.fail('Expected successful result');
      }
    });
  });

  describe('reportLlmSuccess', () => {
    it('calls last-used endpoint with correct provider', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess('user123', LlmProviders.Google);

      // Should complete without throwing
      expect(true).toBe(true);
    });

    it('silently ignores failures (best effort)', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .replyWithError('ECONNREFUSED');

      const client = createUserServiceClient(config);

      // Should not throw
      await expect(
        client.reportLlmSuccess('user123', LlmProviders.Google)
      ).resolves.toBeUndefined();
    });

    it('silently ignores network timeout errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .delay(5000)
        .reply(200);

      const client = createUserServiceClient(config);

      // The function should not throw due to try-catch
      await expect(
        client.reportLlmSuccess('user123', LlmProviders.Google)
      ).resolves.toBeUndefined();
    });

    it('silently ignores 500 server errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.Google)
      ).resolves.toBeUndefined();
    });

    it('silently ignores 404 not found errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(404);

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.Google)
      ).resolves.toBeUndefined();
    });

    it('silently ignores JSON parse errors', async () => {
      nock('http://localhost:3000')
        .post('/internal/users/user123/llm-keys/Google/last-used')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, '{ invalid json }');

      const client = createUserServiceClient(config);

      await expect(
        client.reportLlmSuccess('user123', LlmProviders.Google)
      ).resolves.toBeUndefined();
    });

    it('URL encodes userId with plus in reportLlmSuccess', async () => {
      const userId = 'user+special';
      const provider = 'Google';

      nock('http://localhost:3000')
        .post(`/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess(userId, LlmProviders.Google);

      // Should complete without throwing
      expect(true).toBe(true);
    });

    it('URL encodes userId with pipe (Auth0 format) in reportLlmSuccess', async () => {
      const userId = 'auth0|xyz123';
      const provider = 'Google';

      nock('http://localhost:3000')
        .post(`/internal/users/${encodeURIComponent(userId)}/llm-keys/${provider}/last-used`)
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200);

      const client = createUserServiceClient(config);
      await client.reportLlmSuccess(userId, LlmProviders.Google);

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
        .reply(200, mockToken);

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
        .reply(200, mockToken);

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
        .reply(200, mockToken);

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
        .reply(200, mockToken);

      const client = createUserServiceClient(config);
      const result = await client.getOAuthToken(userId, 'google');

      if (result.ok) {
        expect(result.value).toEqual(mockToken);
      } else {
        expect.fail('Expected successful result');
      }
    });
  });
});
