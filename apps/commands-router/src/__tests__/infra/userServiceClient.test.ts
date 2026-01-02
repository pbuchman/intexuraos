import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../../infra/user/index.js';

const INTEXURAOS_USER_SERVICE_URL = 'http://localhost:8081';
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

  describe('getApiKeys', () => {
    it('returns google API key on success', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { google: 'google-api-key', openai: null, anthropic: null });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
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
      });

      const result = await client.getApiKeys('unknown-user');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('HTTP 404');
      }
    });

    it('returns NETWORK_ERROR on connection failure', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .replyWithError('Connection refused');

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
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
      });

      await client.getApiKeys('user-789');

      expect(scope.isDone()).toBe(true);
    });
  });
});
