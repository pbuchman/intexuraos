import { describe, it, expect } from './testUtils.js';
import { setupTestContext } from './testUtils.js';

describe('pubsubRoutes', () => {
  const ctx = setupTestContext();

  describe('POST /internal/todos/pubsub/todos-processing', () => {
    function createPubSubBody(data: object): object {
      const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
      return {
        message: {
          data: encoded,
          messageId: 'msg-123',
          publishTime: new Date().toISOString(),
        },
        subscription: 'test-subscription',
      };
    }

    it('changes todo status from processing to pending', async () => {
      const todoResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        status: 'processing',
      });
      expect(todoResult.ok).toBe(true);
      if (!todoResult.ok) return;

      const body = createPubSubBody({
        type: 'todos.processing.created',
        todoId: todoResult.value.id,
        userId: 'user-1',
        title: 'Test Todo',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { success: boolean };
      expect(json.success).toBe(true);

      const updated = await ctx.todoRepository.findById(todoResult.value.id);
      expect(updated.ok).toBe(true);
      if (updated.ok && updated.value !== null) {
        expect(updated.value.status).toBe('pending');
      }
    });

    it('accepts request with internal auth token', async () => {
      const todoResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
        status: 'processing',
      });
      expect(todoResult.ok).toBe(true);
      if (!todoResult.ok) return;

      const body = createPubSubBody({
        type: 'todos.processing.created',
        todoId: todoResult.value.id,
        userId: 'user-1',
        title: 'Test Todo',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
    });

    it('rejects request without auth', async () => {
      const body = createPubSubBody({
        type: 'todos.processing.created',
        todoId: 'todo-123',
        userId: 'user-1',
        title: 'Test',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns success for invalid base64 data', async () => {
      const body = {
        message: {
          data: 'not-valid-base64!!!',
          messageId: 'msg-123',
          publishTime: new Date().toISOString(),
        },
        subscription: 'test-subscription',
      };

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { success: boolean };
      expect(json.success).toBe(true);
    });

    it('returns success for unexpected event type', async () => {
      const body = createPubSubBody({
        type: 'some.other.event',
        todoId: 'todo-123',
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { success: boolean };
      expect(json.success).toBe(true);
    });

    it('returns success when todo is not found', async () => {
      const body = createPubSubBody({
        type: 'todos.processing.created',
        todoId: 'non-existent-todo',
        userId: 'user-1',
        title: 'Test',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json() as { success: boolean };
      expect(json.success).toBe(true);
    });

    it('skips todo that is not in processing status', async () => {
      const todoResult = await ctx.todoRepository.create({
        userId: 'user-1',
        title: 'Test Todo',
        tags: [],
        source: 'web',
        sourceId: 'src-1',
      });
      expect(todoResult.ok).toBe(true);
      if (!todoResult.ok) return;

      const body = createPubSubBody({
        type: 'todos.processing.created',
        todoId: todoResult.value.id,
        userId: 'user-1',
        title: 'Test Todo',
        correlationId: 'corr-123',
        timestamp: new Date().toISOString(),
      });

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/internal/todos/pubsub/todos-processing',
        headers: {
          from: 'noreply@google.com',
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);

      const updated = await ctx.todoRepository.findById(todoResult.value.id);
      expect(updated.ok).toBe(true);
      if (updated.ok && updated.value !== null) {
        expect(updated.value.status).toBe('pending');
      }
    });
  });
});
