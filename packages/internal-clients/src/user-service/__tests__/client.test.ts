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
  });
});
