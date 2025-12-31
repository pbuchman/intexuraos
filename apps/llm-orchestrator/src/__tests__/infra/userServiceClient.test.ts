/**
 * Tests for UserServiceClient.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../../infra/user/index.js';

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

  describe('getApiKeys', () => {
    it('returns API keys on success', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {
          google: 'google-api-key',
          openai: 'openai-api-key',
          anthropic: null,
        });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
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
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, {});

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getApiKeys('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });

    it('returns API_ERROR on HTTP 401', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(401, { error: 'Unauthorized' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
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
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .reply(500, { error: 'Internal server error' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
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
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/llm-keys')
        .replyWithError('Connection refused');

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
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

  describe('getWhatsAppPhone', () => {
    it('returns phone number on success', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/whatsapp-phone')
        .matchHeader('X-Internal-Auth', INTERNAL_AUTH_TOKEN)
        .reply(200, { phone: '+1234567890' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getWhatsAppPhone('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('+1234567890');
      }
    });

    it('returns null when phone not configured', async () => {
      nock(USER_SERVICE_URL).get('/internal/users/user-123/whatsapp-phone').reply(200, {});

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getWhatsAppPhone('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null on HTTP 404 (user not found)', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/whatsapp-phone')
        .reply(404, { error: 'Not found' });

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getWhatsAppPhone('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });

    it('returns null on network error (best effort)', async () => {
      nock(USER_SERVICE_URL)
        .get('/internal/users/user-123/whatsapp-phone')
        .replyWithError('Connection refused');

      const client = createUserServiceClient({
        baseUrl: USER_SERVICE_URL,
        internalAuthToken: INTERNAL_AUTH_TOKEN,
      });

      const result = await client.getWhatsAppPhone('user-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
    });
  });
});
