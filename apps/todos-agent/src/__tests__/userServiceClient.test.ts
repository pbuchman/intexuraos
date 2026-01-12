import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../infra/user/userServiceClient.js';

const USER_SERVICE_URL = 'http://localhost:8081';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';

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

  describe('getGeminiApiKey', () => {
    it('returns the google API key on success', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key-123' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

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

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

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

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

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

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 401');
      }
    });

    it('returns API_ERROR on HTTP 404 Not Found', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/unknown-user/llm-keys')
        .reply(404, { error: 'User not found' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getGeminiApiKey('unknown-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 404');
      }
    });

    it('returns API_ERROR on HTTP 500 Internal Server Error', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

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

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getGeminiApiKey('user-123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('sends correct auth header', async () => {
      const scope = nock(USER_SERVICE_URL)
        .get('/internal/users/user-auth-test/llm-keys')
        .matchHeader('X-Internal-Auth', 'custom-token')
        .reply(200, { google: 'key' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: 'custom-token',
      });

      await client.getGeminiApiKey('user-auth-test');

      expect(scope.isDone()).toBe(true);
    });
  });
});
