import { describe, it, expect } from './testUtils.js';
import { setupTestContext } from './testUtils.js';

const TEST_INTERNAL_TOKEN = 'test-internal-token';

describe('Internal Routes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/todos/todos', () => {
    it('creates a todo with valid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Internal Todo',
          tags: ['internal'],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Internal Todo');
      expect(body.data.userId).toBe('user-1');
      expect(body.data.source).toBe('actions-agent');
    });

    it('creates a todo with items', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Todo with Items',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-123',
          items: [
            { title: 'Task 1' },
            { title: 'Task 2', priority: 'high' },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].title).toBe('Task 1');
      expect(body.data.items[1].priority).toBe('high');
    });

    it('returns 401 without internal auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/todos',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Test',
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
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': 'wrong-token',
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Test',
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
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          title: 'Missing userId',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates todo with priority and dueDate', async () => {
      const dueDate = new Date('2025-12-31T23:59:59Z');
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Priority Todo',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-456',
          priority: 'urgent',
          dueDate: dueDate.toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.priority).toBe('urgent');
      expect(body.data.dueDate).toBe(dueDate.toISOString());
    });

    it('returns 500 on storage error', async () => {
      ctx.todoRepository.simulateNextError({ code: 'STORAGE_ERROR', message: 'DB error' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Test',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-123',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
