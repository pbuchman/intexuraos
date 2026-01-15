import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import pino from 'pino';
import { isOk, isErr } from '@intexuraos/common-core';
import { createBookmarksServiceHttpClient } from '../../../infra/http/bookmarksServiceHttpClient.js';

const silentLogger = pino({ level: 'silent' });

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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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

    it('includes existingBookmarkId in error message when provided by API', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(409, {
          success: false,
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Bookmark already exists',
            details: { existingBookmarkId: 'bookmark-existing-123' },
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.error.message).toBe('Bookmark already exists (existingBookmarkId: bookmark-existing-123)');
      }
    });

    it('does not include existingBookmarkId when it is undefined in error response', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(409, {
          success: false,
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Bookmark already exists',
            details: { existingBookmarkId: undefined },
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.error.message).toBe('Bookmark already exists');
        expect(result.error.message).not.toContain('existingBookmarkId');
      }
    });

    it('does not include existingBookmarkId when it is empty string in error response', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(409, {
          success: false,
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Bookmark already exists',
            details: { existingBookmarkId: '' },
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.error.message).toBe('Bookmark already exists');
        expect(result.error.message).not.toContain('existingBookmarkId');
      }
    });

    it('handles error response without details object', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks')
        .reply(409, {
          success: false,
          error: {
            code: 'ALREADY_EXISTS',
            message: 'Bookmark already exists',
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
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
        expect(result.error.message).toBe('Bookmark already exists');
        expect(result.error.message).not.toContain('existingBookmarkId');
      }
    });
  });

  describe('forceRefreshBookmark', () => {
    it('returns refreshed bookmark on success', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-123/force-refresh')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            id: 'bookmark-123',
            url: 'https://example.com/article',
            status: 'active',
            ogPreview: {
              title: 'Updated Title',
              description: 'Updated Description',
              image: 'https://example.com/image.jpg',
            },
            ogFetchStatus: 'processed',
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-123');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.id).toBe('bookmark-123');
        expect(result.value.url).toBe('https://example.com/article');
        expect(result.value.ogFetchStatus).toBe('processed');
        expect(result.value.ogPreview?.title).toBe('Updated Title');
      }
    });

    it('returns error on HTTP 404 (bookmark not found)', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/nonexistent/force-refresh')
        .reply(404, {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Bookmark not found' },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('nonexistent');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Bookmark not found');
      }
    });

    it('returns error on HTTP 500', async () => {
      nock(baseUrl).post('/internal/bookmarks/bookmark-500/force-refresh').reply(500, 'Internal Server Error');

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-500');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error on HTTP 401', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-401/force-refresh')
        .reply(401, { error: 'Unauthorized' });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-401');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error when response success is false', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-fail/force-refresh')
        .reply(200, {
          success: false,
          error: { code: 'FETCH_FAILED', message: 'Failed to fetch preview' },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-fail');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Failed to fetch preview');
      }
    });

    it('returns error when response data is undefined', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-nodata/force-refresh')
        .reply(200, { success: true });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-nodata');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response');
      }
    });

    it('returns error on network failure', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-network/force-refresh')
        .replyWithError('Connection refused');

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-network');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call bookmarks-agent');
      }
    });

    it('returns bookmark with ogFetchStatus failed when fetch fails', async () => {
      nock(baseUrl)
        .post('/internal/bookmarks/bookmark-failed/force-refresh')
        .reply(200, {
          success: true,
          data: {
            id: 'bookmark-failed',
            url: 'https://example.com/article',
            status: 'active',
            ogPreview: null,
            ogFetchStatus: 'failed',
          },
        });

      const client = createBookmarksServiceHttpClient({ baseUrl, internalAuthToken, logger: silentLogger });
      const result = await client.forceRefreshBookmark('bookmark-failed');

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.ogFetchStatus).toBe('failed');
        expect(result.value.ogPreview).toBeNull();
      }
    });
  });
});
