import { describe, it, expect, setupTestContext } from './testUtils.js';

const TEST_INTERNAL_TOKEN = 'test-internal-token';

describe('Internal Routes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/todos', () => {
    it('creates a todo with valid internal auth', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
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
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toContain('Internal Todo');
      expect(body.data.resourceUrl).toMatch(/^\/#\/todos\//);
    });

    it('creates a todo with items', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
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
          items: [{ title: 'Task 1' }, { title: 'Task 2', priority: 'high' }],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toContain('Todo with Items');
      expect(body.data.resourceUrl).toBeDefined();
    });

    it('returns 401 without internal auth header', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
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
        url: '/internal/todos',
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
        url: '/internal/todos',
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
        url: '/internal/todos',
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
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toContain('Priority Todo');
      expect(body.data.resourceUrl).toBeDefined();
    });

    it('returns 500 on storage error', async () => {
      ctx.todoRepository.simulateNextError({ code: 'STORAGE_ERROR', message: 'DB error' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
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

    it('creates todo with items that have priority and dueDate', async () => {
      const itemDueDate = new Date('2025-06-15T12:00:00Z');
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Todo with detailed items',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-789',
          items: [
            { title: 'Item with priority', priority: 'high' },
            { title: 'Item with due date', dueDate: itemDueDate.toISOString() },
            { title: 'Item with both', priority: 'urgent', dueDate: itemDueDate.toISOString() },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toContain('Todo with detailed items');
      expect(body.data.resourceUrl).toBeDefined();
    });

    it('creates todo with all optional fields', async () => {
      const dueDate = new Date('2025-09-01T00:00:00Z');
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Complete Todo',
          description: 'A detailed description',
          tags: ['work', 'important'],
          priority: 'high',
          dueDate: dueDate.toISOString(),
          source: 'actions-agent',
          sourceId: 'action-999',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toBe('Todo "Complete Todo" created successfully');
      expect(body.data.resourceUrl).toBeDefined();
    });

    it('creates todo without optional fields', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Minimal Todo',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-minimal',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toBe('Todo "Minimal Todo" created successfully');
      expect(body.data.resourceUrl).toBeDefined();
    });

    it('creates todo with null optional fields explicitly', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Todo with nulls',
          description: null,
          tags: [],
          dueDate: null,
          source: 'actions-agent',
          sourceId: 'action-null',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toBe('Todo "Todo with nulls" created successfully');
    });

    it('succeeds even when pubsub publish fails', async () => {
      ctx.todosProcessingPublisher.simulateFailure({ code: 'PUBLISH_FAILED', message: 'Failed to publish' });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos',
        headers: {
          'x-internal-auth': TEST_INTERNAL_TOKEN,
          'content-type': 'application/json',
        },
        payload: {
          userId: 'user-1',
          title: 'Todo despite publish failure',
          tags: [],
          source: 'actions-agent',
          sourceId: 'action-publish-fail',
        },
      });

      // Todo creation should still succeed even if publish fails
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('completed');
      expect(body.data.message).toBe('Todo "Todo despite publish failure" created successfully');
    });
  });
});
