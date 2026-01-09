import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { isOk, isErr } from '@intexuraos/common-core';
import { createBookmarksServiceHttpClient } from '../../../infra/http/bookmarksServiceHttpClient.js';

describe('createBookmarksServiceHttpClient', () => {
  const baseUrl = 'http://bookmarks-agent.local';
  const internalAuthToken = 'test-internal-token';

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('createBookmark', () => {
    it('returns bookmark on successful creation', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            id: 'bookmark-123',
            userId: 'user-456',
            url: 'https://example.com/article',
            title: 'Great article',
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com/article',
        title: 'Great article',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.id).toBe('bookmark-123');
        expect(result.value.userId).toBe('user-456');
        expect(result.value.url).toBe('https://example.com/article');
        expect(result.value.title).toBe('Great article');
      }
    });

    it('returns bookmark with null title', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(200, {
          success: true,
          data: {
            id: 'bookmark-123',
            userId: 'user-456',
            url: 'https://example.com/article',
            title: null,
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com/article',
        title: 'Original title',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.title).toBeNull();
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/bookmarks').reply(500, 'Internal Server Error');

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error on HTTP 401', async () => {
      nock(baseUrl).post('/internal/bookmarks').reply(401, { error: 'Unauthorized' });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'not-a-url',
        title: 'Test',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Invalid URL format');
      }
    });

    it('returns error when response data is undefined', async () => {
      nock(baseUrl).post('/internal/bookmarks').reply(200, { success: true });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl).post('/internal/bookmarks').replyWithError('Connection refused');

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com',
        title: 'Test',
        tags: [],
        source: 'actions-agent',
        sourceId: 'action-123',
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call bookmarks-agent');
      }
    });

    it('sends correct request body', async () => {
      const scope = nock(baseUrl)
        .post('/internal/bookmarks', {
          userId: 'user-456',
          url: 'https://example.com/typescript',
          title: 'TypeScript article',
          tags: ['dev', 'typescript'],
          source: 'actions-agent',
          sourceId: 'action-789',
        })
        .reply(200, {
          success: true,
          data: {
            id: 'bookmark-new',
            userId: 'user-456',
            url: 'https://example.com/typescript',
            title: 'TypeScript article',
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken });
      await client.createBookmark({
        userId: 'user-456',
        url: 'https://example.com/typescript',
        title: 'TypeScript article',
        tags: ['dev', 'typescript'],
        source: 'actions-agent',
        sourceId: 'action-789',
      });

      expect(scope.isDone()).toBe(true);
    });
  });
});
