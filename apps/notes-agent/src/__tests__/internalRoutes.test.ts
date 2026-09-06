import { describe, expect, it, setupTestContext } from './testUtils.js';

describe('internalRoutes', () => {
  const ctx = setupTestContext();
  const TEST_INTERNAL_TOKEN = 'test-internal-token';

  describe('POST /internal/notes', () => {
    it('creates a note with valid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-from-service',
          title: 'Internal Note',
          content: 'Created via internal API',
          tags: ['internal'],
          source: 'whatsapp',
          sourceId: 'wa-msg-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toContain('Internal Note');
      const createdNote = ctx.noteRepository.getAll()[0];
      expect(createdNote).toBeDefined();
      if (createdNote === undefined) {
        throw new Error('Expected note to be created');
      }
      expect(body.data.resourceUrl).toBe(`https://intexuraos.cloud/#/notes/${createdNote.id}`);
    });

    it('returns 401 with invalid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes',
        headers: {
          'x-internal-auth': 'wrong-key',
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-id',
          title: 'Note',
          content: 'Content',
          tags: [],
          source: 'test',
          sourceId: 'src-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with missing internal auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-id',
          title: 'Note',
          content: 'Content',
          tags: [],
          source: 'test',
          sourceId: 'src-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns error when note creation fails', async () => {
      ctx.noteRepository.simulateMethodError('create', {
        code: 'STORAGE_ERROR',
        message: 'Database write failed',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-id',
          title: 'Note',
          content: 'Content',
          tags: [],
          source: 'test',
          sourceId: 'src-1',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
      expect(body.data.message).toBe('Database write failed');
    });
  });
});
