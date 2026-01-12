import { describe, it, expect } from './testUtils.js';
import { setupTestContext } from './testUtils.js';

const TEST_INTERNAL_TOKEN = 'test-internal-token';

describe('Internal Routes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/bookmarks', () => {
    it('creates a bookmark with valid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          title: 'Example',
          tags: ['internal'],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBeDefined();
      expect(body.data.url).toMatch(/^\/#\/bookmarks\//);
      expect(body.data.bookmark.url).toBe('https://example.com');
      expect(body.data.bookmark.userId).toBe('user-1');
      expect(body.data.bookmark.source).toBe('actions-agent');
    });

    it('returns 401 without internal auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with invalid internal auth token', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': 'wrong-token',
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for missing required fields', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Missing userId and url',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 on storage error', async () => {
      ctx.bookmarkRepository.simulateNextError({ code: 'STORAGE_ERROR', message: 'DB error' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('creates bookmark without optional fields', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-minimal',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.bookmark.title).toBeNull();
      expect(body.data.bookmark.description).toBeNull();
      expect(body.data.bookmark.ogFetchStatus).toBe('pending');
    });

    it('prevents duplicate URLs and returns existing bookmark ID', async () => {
      const existingResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      expect(existingResult.ok).toBe(true);
      const existingId = existingResult.ok ? existingResult.value.id : '';

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.details?.existingBookmarkId).toBe(existingId);
    });
  });

  describe('GET /internal/bookmarks/:id', () => {
    it('returns bookmark with valid internal auth', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/internal/bookmarks/${createResult.value.id}?userId=user-1`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(createResult.value.id);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/internal/bookmarks/non-existent?userId=user-1',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 without internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/internal/bookmarks/any-id?userId=user-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 on storage error', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/internal/bookmarks/any-id?userId=user-1',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 403 when userId does not match bookmark owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'GET',
        url: `/internal/bookmarks/${createResult.value.id}?userId=other-user`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /internal/bookmarks/:id', () => {
    it('updates bookmark with AI summary', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          aiSummary: 'This is an AI-generated summary of the page',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.aiSummary).toBe('This is an AI-generated summary of the page');
      expect(body.data.aiSummarizedAt).not.toBeNull();
    });

    it('updates bookmark with OG preview', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          ogPreview: {
            title: 'Example Site',
            description: 'An example website',
            image: 'https://example.com/image.jpg',
            siteName: 'Example',
            type: 'website',
            favicon: 'https://example.com/favicon.ico',
          },
          ogFetchStatus: 'processed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.ogPreview.title).toBe('Example Site');
      expect(body.data.ogFetchStatus).toBe('processed');
      expect(body.data.ogFetchedAt).not.toBeNull();
    });

    it('updates bookmark title and description', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Updated Title',
          description: 'Updated Description',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.title).toBe('Updated Title');
      expect(body.data.description).toBe('Updated Description');
    });

    it('returns 404 for non-existent bookmark', async () => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/internal/bookmarks/non-existent',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          aiSummary: 'Summary',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 without internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/internal/bookmarks/any-id',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          aiSummary: 'Summary',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 on storage error', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.bookmarkRepository.simulateMethodError('update', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          aiSummary: 'Summary',
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('updates ogFetchStatus to failed', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          ogFetchStatus: 'failed',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.ogFetchStatus).toBe('failed');
    });

    it('updates tags and archived status', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/internal/bookmarks/${createResult.value.id}`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          tags: ['new-tag'],
          archived: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.tags).toEqual(['new-tag']);
      expect(body.data.archived).toBe(true);
    });
  });

  describe('POST /internal/bookmarks/:id/force-refresh', () => {
    it('returns 401 when no internal auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/bookmark-123/force-refresh',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when bookmark not found', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks/non-existent/force-refresh',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('force refreshes bookmark with fresh OG data', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com/article',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const response = await ctx.app.inject({
        method: 'POST',
        url: `/internal/bookmarks/${createResult.value.id}/force-refresh`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.ogFetchStatus).toBe('processed');
      expect(body.data.ogPreview).toEqual({
        title: 'Test Title',
        description: 'Test Description',
        image: 'https://example.com/image.jpg',
        siteName: 'Example Site',
        favicon: 'https://example.com/favicon.ico',
        type: null,
      });
    });

    it('sets ogFetchStatus to failed when fetchPreview fails', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com/article',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.linkPreviewFetcher.setNextResult({
        ok: false,
        error: { code: 'FETCH_FAILED', message: 'Network error' },
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: `/internal/bookmarks/${createResult.value.id}/force-refresh`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.ogFetchStatus).toBe('failed');
    });

    it('returns 500 on storage error', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      ctx.bookmarkRepository.simulateMethodError('update', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: `/internal/bookmarks/${createResult.value.id}/force-refresh`,
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Error on findByUserIdAndUrl during internal create', () => {
    it('returns 500 when findByUserIdAndUrl fails', async () => {
      ctx.bookmarkRepository.simulateMethodError('findByUserIdAndUrl', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/bookmarks',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          url: 'https://example.com',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('findById error during internal PATCH', () => {
    it('returns 500 when findById fails', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/internal/bookmarks/any-id',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          aiSummary: 'Summary',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
