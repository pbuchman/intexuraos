/**
 * Tests for userServiceClient.
 */

import { LlmProviders } from '@intexuraos/llm-contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createUserServiceClient } from '../../../infra/user/userServiceClient.js';

describe('createUserServiceClient', () => {
  const baseUrl = 'http://user-service.local';
  const internalAuthToken = 'test-token';

  beforeEach(() => {
    nock.cleanAll();
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

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
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

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
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

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      const result = await client.getApiKeys('user-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns NETWORK_ERROR on network failure', async () => {
      nock(baseUrl).get('/internal/users/user-1/llm-keys').replyWithError('Connection refused');

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
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

      const client = createUserServiceClient({ baseUrl, internalAuthToken });
      await client.reportLlmSuccess('user-1', LlmProviders.Google);

      expect(scope.isDone()).toBe(true);
    });

    it('does not throw on network error (best effort)', async () => {
      nock(baseUrl)
        .post('/internal/users/user-1/llm-keys/openai/last-used')
        .replyWithError('Connection refused');

      const client = createUserServiceClient({ baseUrl, internalAuthToken });

      await expect(client.reportLlmSuccess('user-1', LlmProviders.OpenAI)).resolves.toBeUndefined();
    });

    it('does not throw on error response (best effort)', async () => {
      nock(baseUrl).post('/internal/users/user-1/llm-keys/anthropic/last-used').reply(500);

      const client = createUserServiceClient({ baseUrl, internalAuthToken });

      await expect(
        client.reportLlmSuccess('user-1', LlmProviders.Anthropic)
      ).resolves.toBeUndefined();
    });
  });
});
