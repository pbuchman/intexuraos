/**
 * Tests for UserServiceClient.
 */

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
    it('returns API keys on success', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          google: 'google-api-key',
          openai: 'openai-api-key',
          anthropic: null,
        });

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.google).toBe('google-api-key');
        expect(result.value.openai).toBe('openai-api-key');
        expect(result.value.anthropic).toBeUndefined();
      }
    });

    it('returns empty object when no keys exist', async () => {
      nock(INTEXURAOS_USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      const client = createUserServiceClient({
        baseUrl: INTEXURAOS_USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
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
        expect(result.error.message).toBe('HTTP 401');
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
        expect(result.error.message).toBe('HTTP 500');
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
  });
});
