import { describe, expect, it, setupTestContext } from './testUtils.js';

describe('internalRoutes', () => {
  const ctx = setupTestContext();
  const TEST_INTERNAL_TOKEN = 'test-internal-token';

  describe('POST /internal/notes/notes', () => {
    it('creates a note with valid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes/notes',
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
      expect(body.data.title).toBe('Internal Note');
      expect(body.data.userId).toBe('user-from-service');
      expect(body.data.source).toBe('whatsapp');
    });

    it('returns 401 with invalid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/notes/notes',
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
        url: '/internal/notes/notes',
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
  });
});
