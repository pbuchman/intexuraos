import { describe, it, expect } from './testUtils.js';
import { setupTestContext, createToken } from './testUtils.js';

describe('Bookmark Routes', () => {
  const ctx = setupTestContext();

  describe('GET /bookmarks', () => {
    it('returns empty list initially', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns user bookmarks', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        title: 'Example',
        tags: ['test'],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].url).toBe('https://example.com');
    });

    it('filters by archived', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      if (createResult.ok) {
        const bookmark = createResult.value;
        bookmark.archived = true;
        await ctx.bookmarkRepository.update(bookmark.id, bookmark);
      }

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks?archived=true',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].archived).toBe(true);
    });

    it('filters by tags', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: ['work', 'important'],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks?tags=work',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });

    it('filters by ogFetchStatus', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks?ogFetchStatus=pending',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].ogFetchStatus).toBe('pending');
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 on storage error', async () => {
      ctx.bookmarkRepository.simulateMethodError('findByUserId', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /bookmarks', () => {
    it('creates a bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          title: 'Example Site',
          tags: ['test'],
          source: 'web',
          sourceId: 'src-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.url).toBe('https://example.com');
      expect(body.data.ogFetchStatus).toBe('pending');
    });

    it('prevents duplicate URLs for same user', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-2',
        },
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 400 for missing required fields', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Missing url' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 on storage error', async () => {
      ctx.bookmarkRepository.simulateNextError({ code: 'STORAGE_ERROR', message: 'DB error' });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('GET /bookmarks/:id', () => {
    it('returns bookmark for owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/bookmarks/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.id).toBe(createResult.value.id);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/bookmarks/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks/non-existent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 500 on storage error', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks/any-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('PATCH /bookmarks/:id', () => {
    it('updates bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/bookmarks/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated Title' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.title).toBe('Updated Title');
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/bookmarks/bookmark-123',
        headers: { 'content-type': 'application/json' },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/bookmarks/non-existent',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/bookmarks/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Hacked' },
      });

      expect(response.statusCode).toBe(403);
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

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/bookmarks/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /bookmarks/:id', () => {
    it('deletes bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/bookmarks/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(ctx.bookmarkRepository.getAll()).toHaveLength(0);
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/bookmarks/bookmark-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/bookmarks/non-existent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/bookmarks/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
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

      ctx.bookmarkRepository.simulateMethodError('delete', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/bookmarks/${createResult.value.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /bookmarks/:id/archive', () => {
    it('archives bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${createResult.value.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/bookmark-123/archive',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/non-existent/archive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${createResult.value.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
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

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${createResult.value.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('POST /bookmarks/:id/unarchive', () => {
    it('unarchives bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const bookmark = createResult.value;
      bookmark.archived = true;
      await ctx.bookmarkRepository.update(bookmark.id, bookmark);

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${bookmark.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(false);
    });

    it('returns 401 without auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/bookmark-123/unarchive',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for non-existent bookmark', async () => {
      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/non-existent/unarchive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 for non-owner', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'other-user' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${createResult.value.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
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

      const bookmark = createResult.value;
      bookmark.archived = true;
      await ctx.bookmarkRepository.update(bookmark.id, bookmark);

      ctx.bookmarkRepository.simulateMethodError('update', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${bookmark.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Additional filter cases', () => {
    it('filters by archived=false', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks?archived=false',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].archived).toBe(false);
    });

    it('filters by comma-separated tags', async () => {
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: ['work', 'urgent'],
        source: 'web',
        sourceId: 'src-1',
      });
      await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://other.com',
        tags: ['personal'],
        source: 'web',
        sourceId: 'src-2',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/bookmarks?tags=work,urgent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].tags).toContain('work');
    });
  });

  describe('Bookmark update with all fields', () => {
    it('updates bookmark description and tags', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/bookmarks/${createResult.value.id}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          description: 'New description',
          tags: ['updated', 'tags'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.description).toBe('New description');
      expect(body.data.tags).toEqual(['updated', 'tags']);
    });
  });

  describe('Error on findByUserIdAndUrl', () => {
    it('returns 500 when findByUserIdAndUrl fails during create', async () => {
      ctx.bookmarkRepository.simulateMethodError('findByUserIdAndUrl', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Error on create method specifically', () => {
    it('returns 500 when create fails after findByUserIdAndUrl succeeds', async () => {
      ctx.bookmarkRepository.simulateMethodError('create', {
        code: 'STORAGE_ERROR',
        message: 'DB error on create',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          tags: [],
          source: 'web',
          sourceId: 'src-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Error on findById for update', () => {
    it('returns 500 when findById fails during PATCH', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: '/bookmarks/any-id',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Error on findById for delete', () => {
    it('returns 500 when findById fails during DELETE', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/bookmarks/any-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Archive edge cases', () => {
    it('returns 500 when findById fails during archive', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/any-id/archive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 200 when archiving already archived bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const bookmark = createResult.value;
      bookmark.archived = true;
      await ctx.bookmarkRepository.update(bookmark.id, bookmark);

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${bookmark.id}/archive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(true);
    });
  });

  describe('Unarchive edge cases', () => {
    it('returns 500 when findById fails during unarchive', async () => {
      ctx.bookmarkRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'DB error',
      });

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/bookmarks/any-id/unarchive',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 200 when unarchiving non-archived bookmark', async () => {
      const createResult = await ctx.bookmarkRepository.create({
        userId: 'user-1',
        url: 'https://example.com',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const token = await createToken({ sub: 'user-1' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/bookmarks/${createResult.value.id}/unarchive`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.archived).toBe(false);
    });
  });
});
