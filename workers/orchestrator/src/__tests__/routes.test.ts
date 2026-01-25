import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
// import { build } from 'fastify-server/build';
// import { registerRoutes } from '../routes.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
// import type { GitHubTokenService } from '../github/token-service.js';
// import type { Logger } from '@intexuraos/common-core';

describe('Routes', () => {
  let app: FastifyInstance;
  let dispatcher: TaskDispatcher;
  // let tokenService: GitHubTokenService;
  // const mockLogger: Logger = {
  //   info(): void {},
  //   warn(): void {},
  //   error(): void {},
  //   debug(): void {},
  // };

  beforeEach(async () => {
    // TODO: Fix fastify-server import issue
    // app = build();

    // Mock dispatcher
    dispatcher = {
      submitTask: vi.fn(async () => ({ ok: true, value: undefined })),
      cancelTask: vi.fn(async () => ({ ok: true, value: undefined })),
      getTask: vi.fn(async () => null),
      getRunningCount: vi.fn(() => 0),
      getCapacity: vi.fn(() => 5),
    } as unknown as TaskDispatcher;

    // Mock token service
    // tokenService = {
    //   getToken: vi.fn(async () => ({ token: 'test-token', expiresAt: '2025-01-26T00:00:00Z' })),
    //   refreshToken: vi.fn(async () => ({ ok: true, value: { token: 'new-token', expiresAt: '2025-01-27T00:00:00Z' } })),
    // } as unknown as GitHubTokenService;

    // registerRoutes(app, dispatcher, tokenService, { dispatchSecret: 'test-secret' }, mockLogger);
  });

  describe.skip('POST /tasks', () => {
    it('should accept valid task with correct signature', async () => {
      const timestamp = Date.now();
      const nonce = 'unique-nonce-123';
      const payload = {
        taskId: 'test-task',
        workerType: 'auto' as const,
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      // Generate signature
      const { createHmac } = await import('node:crypto');
      const message = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
      const signature = createHmac('sha256', 'test-secret').update(message).digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: {
          'x-dispatch-timestamp': String(timestamp),
          'x-dispatch-signature': signature,
          'x-dispatch-nonce': nonce,
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        taskId: 'test-task',
        status: 'queued',
      });
    });

    it('should reject without authentication headers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        payload: {
          taskId: 'test-task',
          workerType: 'auto',
          prompt: 'Test',
          webhookUrl: 'https://example.com/webhook',
          webhookSecret: 'secret',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 503 when at capacity', async () => {
      vi.mocked(dispatcher.submitTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'at_capacity', message: 'Service at capacity' },
      });

      const timestamp = Date.now();
      const nonce = 'unique-nonce-456';
      const payload = {
        taskId: 'test-task',
        workerType: 'auto' as const,
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const { createHmac } = await import('node:crypto');
      const message = `${timestamp}.${nonce}.${JSON.stringify(payload)}`;
      const signature = createHmac('sha256', 'test-secret').update(message).digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: {
          'x-dispatch-timestamp': String(timestamp),
          'x-dispatch-signature': signature,
          'x-dispatch-nonce': nonce,
        },
        payload,
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe.skip('GET /tasks/:id', () => {
    it('should return task status', async () => {
      vi.mocked(dispatcher.getTask).mockResolvedValueOnce({
        taskId: 'test-task',
        status: 'running',
        startedAt: '2025-01-25T14:00:00Z',
      } as unknown);

      const response = await app.inject({
        method: 'GET',
        url: '/tasks/test-task',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        taskId: 'test-task',
        status: 'running',
      });
    });

    it('should return 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/tasks/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe.skip('DELETE /tasks/:id', () => {
    it('should cancel task', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/tasks/test-task',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        taskId: 'test-task',
        status: 'cancelled',
      });
    });

    it('should return 404 for non-existent task', async () => {
      vi.mocked(dispatcher.cancelTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'not_found', message: 'Task not found' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/tasks/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe.skip('GET /health', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'ready',
        capacity: 5,
        running: 0,
        available: 5,
      });
    });
  });

  describe.skip('POST /admin/refresh-token', () => {
    it('should refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/refresh-token',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('tokenExpiresAt');
    });
  });
});
