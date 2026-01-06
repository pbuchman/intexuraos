import { createToken, describe, expect, it, setupTestContext } from './testUtils.js';

describe('noteRoutes', () => {
  const ctx = setupTestContext();

  describe('GET /notes', () => {
    it('returns empty array when no notes exist', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns notes for the authenticated user', async () => {
      await ctx.noteRepository.create({
        userId: 'test-user-123',
        title: 'Test Note',
        content: 'Content',
        tags: ['tag1'],
        source: 'test',
        sourceId: 'src-1',
      });

      await ctx.noteRepository.create({
        userId: 'other-user',
        title: 'Other Note',
        content: 'Other',
        tags: [],
        source: 'test',
        sourceId: 'src-2',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].title).toBe('Test Note');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when repository fails', async () => {
      ctx.noteRepository.simulateMethodError('findByUserId', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /notes', () => {
    it('creates a note for the authenticated user', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notes',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'New Note',
          content: 'Note content',
          tags: ['important'],
          source: 'web',
          sourceId: 'web-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.title).toBe('New Note');
      expect(body.data.userId).toBe('test-user-123');
      expect(body.data.tags).toEqual(['important']);
    });

    it('returns 500 when repository fails', async () => {
      ctx.noteRepository.simulateMethodError('create', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notes',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: {
          title: 'New Note',
          content: 'Note content',
          tags: [],
          source: 'web',
          sourceId: 'web-123',
        },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/notes',
        headers: { 'content-type': 'application/json' },
        payload: {
          title: 'New Note',
          content: 'Content',
          tags: [],
          source: 'web',
          sourceId: 'web-123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /notes/:id', () => {
    it('returns a note by ID', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'test-user-123',
        title: 'Test Note',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/notes/${created.ok ? created.value.id : ''}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.title).toBe('Test Note');
    });

    it('returns 404 for non-existent note', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes/non-existent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 for note owned by another user', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'other-user',
        title: 'Other Note',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/notes/${created.ok ? created.value.id : ''}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 when repository fails', async () => {
      ctx.noteRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes/any-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/notes/any-id',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('PUT /notes/:id', () => {
    it('updates a note', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'test-user-123',
        title: 'Original',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/notes/${created.ok ? created.value.id : ''}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.title).toBe('Updated');
    });

    it('returns 403 for note owned by another user', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'other-user',
        title: 'Other',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: `/notes/${created.ok ? created.value.id : ''}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Hacked' },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-existent note', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/notes/non-existent-id',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repository fails', async () => {
      ctx.noteRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/notes/any-id',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/notes/any-id',
        headers: { 'content-type': 'application/json' },
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /notes/:id', () => {
    it('deletes a note', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'test-user-123',
        title: 'To Delete',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const noteId = created.ok ? created.value.id : '';

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${noteId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);

      const findResult = await ctx.noteRepository.findById(noteId);
      expect(findResult.ok && findResult.value).toBeNull();
    });

    it('returns 403 for note owned by another user', async () => {
      const created = await ctx.noteRepository.create({
        userId: 'other-user',
        title: 'Other',
        content: 'Content',
        tags: [],
        source: 'test',
        sourceId: 'src-1',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/notes/${created.ok ? created.value.id : ''}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 404 for non-existent note', async () => {
      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notes/non-existent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when repository fails', async () => {
      ctx.noteRepository.simulateMethodError('findById', {
        code: 'STORAGE_ERROR',
        message: 'Database error',
      });

      const token = await createToken({ sub: 'test-user-123' });
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notes/any-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/notes/any-id',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
