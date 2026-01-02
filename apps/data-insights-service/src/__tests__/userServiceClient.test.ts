import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../infra/user/userServiceClient.js';

describe('userServiceClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getGeminiApiKey', () => {
    it('returns API key when available', async () => {
      const client = createUserServiceClient({
        baseUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
      });

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { google: 'test-api-key' });

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('test-api-key');
      }
    });

    it('returns NO_API_KEY error when key is null', async () => {
      const client = createUserServiceClient({
        baseUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
      });

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .reply(200, { google: null });

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns NO_API_KEY error when key is undefined', async () => {
      const client = createUserServiceClient({
        baseUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
      });

      nock('http://localhost:8110').get('/internal/users/user-123/llm-keys').reply(200, {});

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_API_KEY');
      }
    });

    it('returns API_ERROR when HTTP status is not ok', async () => {
      const client = createUserServiceClient({
        baseUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
      });

      nock('http://localhost:8110').get('/internal/users/user-123/llm-keys').reply(500);

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      const client = createUserServiceClient({
        baseUrl: 'http://localhost:8110',
        internalAuthToken: 'test-token',
      });

      nock('http://localhost:8110')
        .get('/internal/users/user-123/llm-keys')
        .replyWithError('Connection refused');

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });
});
