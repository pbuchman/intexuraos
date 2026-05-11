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
        source: 'actions-agent',
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
      source: 'actions-agent',
      sourceId: 'action-1',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-1',
        userId: 'user-1',
        url: 'https://example.com/article',
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
          url: '/#/bookmarks/bookmark-2',
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
            source: 'actions-agent',
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
      source: 'actions-agent',
      sourceId: 'action-2',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'bookmark-2',
        userId: 'user-2',
        url: 'https://example.com/nested',
        title: 'Nested bookmark',
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
      source: 'actions-agent',
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
      source: 'actions-agent',
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
      source: 'actions-agent',
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
      source: 'actions-agent',
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
          source: 'actions-agent',
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
