import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { registerRoutes } from '../routes.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { Logger } from '@intexuraos/common-core';

describe('Routes', () => {
  let app: FastifyInstance;
  let dispatcher: TaskDispatcher;
  let tokenService: GitHubTokenService;

  const mockLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  const dispatchSecret = 'test-secret';

  const createSignedRequest = (
    payload: object
  ): { headers: Record<string, string>; body: string } => {
    const timestamp = String(Date.now());
    const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
    const body = JSON.stringify(payload);
    const message = `${timestamp}.${nonce}.${body}`;
    const signature = createHmac('sha256', dispatchSecret).update(message).digest('hex');

    return {
      headers: {
        'x-dispatch-timestamp': timestamp,
        'x-dispatch-signature': signature,
        'x-dispatch-nonce': nonce,
        'content-type': 'application/json',
      },
      body,
    };
  };

  beforeEach(async () => {
    app = Fastify();

    dispatcher = {
      submitTask: vi.fn(async () => ({ ok: true, value: undefined })),
      cancelTask: vi.fn(async () => ({ ok: true, value: undefined })),
      getTask: vi.fn(async () => null),
      getRunningCount: vi.fn(() => 0),
      getCapacity: vi.fn(() => 5),
    } as unknown as TaskDispatcher;

    tokenService = {
      getToken: vi.fn(async () => 'test-token'),
      getExpiresAt: vi.fn(() => new Date(Date.now() + 3600000)),
      refreshToken: vi.fn(async () => ({ ok: true, value: 'new-token' })),
    } as unknown as GitHubTokenService;

    registerRoutes(app, dispatcher, tokenService, { dispatchSecret }, mockLogger);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /tasks', () => {
    it('should accept valid task with correct signature', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const { headers, body } = createSignedRequest(taskPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
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

      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const { headers, body } = createSignedRequest(taskPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe('GET /tasks/:id', () => {
    it('should return task status', async () => {
      vi.mocked(dispatcher.getTask).mockResolvedValueOnce({
        taskId: 'test-task',
        status: 'running',
        startedAt: '2025-01-25T14:00:00Z',
      } as never);

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

  describe('DELETE /tasks/:id', () => {
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

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toMatchObject({
        status: 'ready',
        capacity: 5,
        running: 0,
        available: 5,
      });
      expect(json).toHaveProperty('githubTokenExpiresAt');
    });
  });

  describe('POST /admin/refresh-token', () => {
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
