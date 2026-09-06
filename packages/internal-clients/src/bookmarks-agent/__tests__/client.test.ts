import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookmarksAgentServiceClient } from '../client.js';
import type { BookmarksAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://bookmarks-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as BookmarksAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createBookmarksAgentServiceClient', () => {
  it('returns bookmark data on create success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/bookmarks', {
        userId: 'user-1',
        url: 'https://example.com/article',
        source: 'intex-agent',
        sourceId: 'action-1',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-1',
          userId: 'user-1',
          url: 'https://example.com/article',
          title: null,
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-1',
        userId: 'user-1',
        url: 'https://example.com/article',
        resourceUrl: undefined,
        title: null,
      },
    });
  });

  it('supports nested bookmark create envelopes from the shared route contract', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-2',
          url: 'https://example.com/nested',
          resourceUrl: 'https://intexuraos.cloud/#/bookmarks/bookmark-2',
          bookmark: {
            id: 'bookmark-2',
            userId: 'user-2',
            status: 'active',
            url: 'https://example.com/nested',
            title: 'Nested bookmark',
            description: null,
            tags: [],
            ogPreview: null,
            ogFetchedAt: null,
            ogFetchStatus: 'processed',
            aiSummary: null,
            aiSummarizedAt: null,
            source: 'intex-agent',
            sourceId: 'action-2',
            archived: false,
            createdAt: '2026-05-10T00:00:00.000Z',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-2',
      url: 'https://example.com/nested',
      source: 'intex-agent',
      sourceId: 'action-2',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-2',
        userId: 'user-2',
        url: 'https://example.com/nested',
        resourceUrl: 'https://intexuraos.cloud/#/bookmarks/bookmark-2',
        title: 'Nested bookmark',
      },
    });
  });

  it('supports nested bookmark create envelopes without resource URLs', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-3',
          url: 'https://example.com/nested-without-resource',
          bookmark: {
            id: 'bookmark-3',
            userId: 'user-3',
            status: 'active',
            url: 'https://example.com/nested-without-resource',
            title: 'Nested bookmark without resource URL',
            description: null,
            tags: [],
            ogPreview: null,
            ogFetchedAt: null,
            ogFetchStatus: 'processed',
            aiSummary: null,
            aiSummarizedAt: null,
            source: 'intex-agent',
            sourceId: 'action-3',
            archived: false,
            createdAt: '2026-05-10T00:00:00.000Z',
            updatedAt: '2026-05-10T00:00:00.000Z',
          },
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-3',
      url: 'https://example.com/nested-without-resource',
      source: 'intex-agent',
      sourceId: 'action-3',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-3',
        userId: 'user-3',
        url: 'https://example.com/nested-without-resource',
        title: 'Nested bookmark without resource URL',
      },
    });
  });

  it('preserves bookmark conflict details on create errors', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks')
      .reply(409, {
        success: false,
        error: {
          code: 'ALREADY_EXISTS',
          message: 'Bookmark already exists',
          details: {
            existingBookmarkId: 'bookmark-existing-1',
          },
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'Bookmark already exists',
        errorCode: 'ALREADY_EXISTS',
        existingBookmarkId: 'bookmark-existing-1',
      },
    });
  });

  it('falls back to HTTP status text when create errors have a primitive body', async () => {
    nock(BASE_URL).post('/internal/bookmarks').reply(500, 'server exploded');

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'source-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'HTTP 500: Internal Server Error',
      },
    });
  });

  it('omits optional create error fields when the envelope omits them', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks')
      .reply(409, {
        success: false,
        error: {
          message: 'Bookmark already exists',
          details: {
            existingBookmarkId: '',
          },
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'source-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'Bookmark already exists',
      },
    });
  });

  it('falls back to the HTTP status when create API errors omit an error object', async () => {
    nock(BASE_URL).post('/internal/bookmarks').reply(500, {
      success: false,
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'source-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'HTTP 500: Internal Server Error',
      },
    });
  });

  it('maps malformed create success envelopes to a create error', async () => {
    nock(BASE_URL).post('/internal/bookmarks').reply(200, {
      success: true,
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'source-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'Invalid response from bookmarks-agent',
      },
    });
  });

  it('maps success=false create envelopes without details to typed errors', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks')
      .reply(200, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'URL is invalid',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'not-a-url',
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'URL is invalid',
        errorCode: 'VALIDATION_ERROR',
      },
    });
  });

  it('uses fallback create error values when success=false omits error details', async () => {
    nock(BASE_URL).post('/internal/bookmarks').reply(200, {
      success: false,
      error: {},
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1000,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        message: 'Invalid response from bookmarks-agent',
      },
    });
  });

  it('maps create transport failures to SERVICE_UNAVAILABLE', async () => {
    nock(BASE_URL).post('/internal/bookmarks').replyWithError('Connection refused');

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createBookmark({
      userId: 'user-1',
      url: 'https://example.com/article',
      source: 'intex-agent',
      sourceId: 'action-1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Failed to call bookmarks-agent');
      expect(result.error.errorCode).toBe('SERVICE_UNAVAILABLE');
    }
  });

  it('returns refreshed bookmark data on success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-1/force-refresh')
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-1',
          url: 'https://example.com/article',
          status: 'active',
          ogPreview: null,
          ogFetchStatus: 'processed',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-1',
        url: 'https://example.com/article',
        status: 'active',
        ogPreview: null,
        ogFetchStatus: 'processed',
      },
    });
  });

  it('normalizes partial ogPreview fields to explicit nulls on refresh success', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-2/force-refresh')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-2',
          userId: 'user-1',
          status: 'active',
          url: 'https://example.com/preview',
          title: 'Preview bookmark',
          description: null,
          tags: [],
          ogPreview: {
            image: 'https://example.com/preview.png',
          },
          ogFetchedAt: null,
          ogFetchStatus: 'processed',
          aiSummary: null,
          aiSummarizedAt: null,
          source: 'intex-agent',
          sourceId: 'action-2',
          archived: false,
          createdAt: '2026-05-10T00:00:00.000Z',
          updatedAt: '2026-05-10T00:00:00.000Z',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-2');

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-2',
        url: 'https://example.com/preview',
        status: 'active',
        ogPreview: {
          title: null,
          description: null,
          image: 'https://example.com/preview.png',
          siteName: null,
          favicon: null,
        },
        ogFetchStatus: 'processed',
      },
    });
  });

  it('normalizes empty ogPreview fields to explicit nulls on refresh success', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-3/force-refresh')
      .reply(200, {
        success: true,
        data: {
          id: 'bookmark-3',
          url: 'https://example.com/empty-preview',
          status: 'active',
          ogPreview: {},
          ogFetchStatus: 'processed',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-3');

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-3',
        url: 'https://example.com/empty-preview',
        status: 'active',
        ogPreview: {
          title: null,
          description: null,
          image: null,
          siteName: null,
          favicon: null,
        },
        ogFetchStatus: 'processed',
      },
    });
  });

  it('maps refresh transport failures to errors', async () => {
    nock(BASE_URL).post('/internal/bookmarks/bookmark-1/force-refresh').replyWithError('offline');

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Failed to call bookmarks-agent');
    }
  });

  it('returns http error messages for refresh failures', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-1/force-refresh')
      .reply(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Bookmark not found',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Bookmark not found');
    }
  });

  it('falls back to status text for primitive refresh API error bodies', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-1/force-refresh')
      .reply(500, 'server exploded');

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('HTTP 500: Internal Server Error');
    }
  });

  it('falls back to status text when refresh API error envelopes omit a message', async () => {
    nock(BASE_URL).post('/internal/bookmarks/bookmark-1/force-refresh').reply(500, {
      success: false,
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('HTTP 500: Internal Server Error');
    }
  });

  it('maps malformed refresh success envelopes to fallback errors', async () => {
    nock(BASE_URL).post('/internal/bookmarks/bookmark-1/force-refresh').reply(200, {
      success: true,
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from bookmarks-agent');
    }
  });

  it('maps success=false refresh envelopes to their error message', async () => {
    nock(BASE_URL)
      .post('/internal/bookmarks/bookmark-1/force-refresh')
      .reply(200, {
        success: false,
        error: {
          code: 'REFRESH_FAILED',
          message: 'Refresh failed',
        },
      });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Refresh failed');
    }
  });

  it('uses fallback refresh message when success=false omits error details', async () => {
    nock(BASE_URL).post('/internal/bookmarks/bookmark-1/force-refresh').reply(200, {
      success: false,
      error: {},
    });

    const client = createBookmarksAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.forceRefreshBookmark('bookmark-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Invalid response from bookmarks-agent');
    }
  });
});
