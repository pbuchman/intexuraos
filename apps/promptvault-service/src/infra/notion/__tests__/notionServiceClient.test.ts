import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { createNotionServiceClient } from '../notionServiceClient.js';
import { isErr, isOk } from '@intexuraos/common-core';

describe('NotionServiceClient', () => {
  const baseUrl = 'http://localhost:3000';
  const internalAuthToken = 'test-internal-token';
  const userId = 'user-123';

  let client: ReturnType<typeof createNotionServiceClient>;

  beforeEach(() => {
    client = createNotionServiceClient({ baseUrl, internalAuthToken });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('getNotionToken', () => {
    it('returns token context when user is connected', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(200, {
          connected: true,
          token: 'secret_notion_token',
        });

      const result = await client.getNotionToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.connected).toBe(true);
        expect(result.value.token).toBe('secret_notion_token');
      }
    });

    it('returns disconnected context when user has no Notion connection', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(200, {
          connected: false,
          token: null,
        });

      const result = await client.getNotionToken(userId);

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.connected).toBe(false);
        expect(result.value.token).toBe(null);
      }
    });

    it('returns UNAUTHORIZED error when auth token is invalid', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(401, { error: 'Unauthorized' });

      const result = await client.getNotionToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('UNAUTHORIZED');
        expect(result.error.message).toContain('Internal auth failed');
      }
    });

    it('returns DOWNSTREAM_ERROR when notion-service returns 500', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const result = await client.getNotionToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns DOWNSTREAM_ERROR when notion-service returns 502', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .reply(502, 'Bad Gateway');

      const result = await client.getNotionToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('DOWNSTREAM_ERROR');
        expect(result.error.message).toContain('502');
      }
    });

    it('returns INTERNAL_ERROR when network request fails', async () => {
      nock(baseUrl)
        .get(`/internal/notion/users/${userId}/context`)
        .matchHeader('x-internal-auth', internalAuthToken)
        .replyWithError('Network error');

      const result = await client.getNotionToken(userId);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Failed to fetch Notion token');
      }
    });
  });
});
