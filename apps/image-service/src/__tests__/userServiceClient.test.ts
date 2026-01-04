import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../infra/user/userServiceClient.js';

describe('UserServiceClient', () => {
  const baseUrl = 'http://localhost:8110';
  const internalAuthToken = 'test-token';

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  describe('getApiKeys', () => {
    it('returns API keys on success', async () => {
      nock(baseUrl)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          google: 'google-key',
          openai: 'openai-key',
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBe('google-key');
        expect(result.value.openai).toBe('openai-key');
      }
    });

    it('converts null values to undefined', async () => {
      nock(baseUrl)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          google: null,
          openai: 'openai-key',
        });

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBeUndefined();
        expect(result.value.openai).toBe('openai-key');
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(baseUrl)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, { error: 'Internal error' });

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      nock(baseUrl).get('/internal/users/user-123/llm-keys').replyWithError('Connection refused');

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('handles empty response', async () => {
      nock(baseUrl)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {});

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBeUndefined();
        expect(result.value.openai).toBeUndefined();
      }
    });
  });
});
