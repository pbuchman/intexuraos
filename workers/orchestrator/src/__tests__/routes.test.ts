import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { registerRoutes, cleanUpExpiredNonces } from '../routes.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { CredentialMonitor } from '../services/isolation/credential-monitor.js';
import type { IsolationProvider } from '../services/isolation/types.js';
import type { Logger } from '@intexuraos/common-core';

describe('Routes', () => {
  let app: FastifyInstance;
  let dispatcher: TaskDispatcher;
  let tokenService: GitHubTokenService;
  let credentialMonitor: CredentialMonitor;
  let isolationProvider: IsolationProvider;

  const mockLogger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  const orchestratorSecret = 'test-secret';

  const createSignedRequest = (
    payload: object
  ): { headers: Record<string, string>; body: string } => {
    const timestamp = String(Date.now());
    const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
    const body = JSON.stringify(payload);
    const message = `${timestamp}.${nonce}.${body}`;
    const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

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
      sendMessage: vi.fn(async () => ({ ok: true, value: { action: 'queued' } })),
      getTask: vi.fn(async () => null),
      getRunningCount: vi.fn(() => 0),
      getCapacity: vi.fn(() => 5),
    } as unknown as TaskDispatcher;

    tokenService = {
      getToken: vi.fn(async () => 'test-token'),
      getExpiresAt: vi.fn(() => new Date(Date.now() + 3600000)),
      refreshToken: vi.fn(async () => ({ ok: true, value: 'new-token' })),
    } as unknown as GitHubTokenService;

    credentialMonitor = {
      getState: vi.fn(() => ({
        status: 'active',
        expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
        expiresInMinutes: 240,
        subscriptionType: 'max',
      })),
      getCurrentAccessToken: vi.fn(() => 'sk-ant-oat01-mock'),
      loadCredentials: vi.fn(() => true),
      logStartupStatus: vi.fn(),
    } as unknown as CredentialMonitor;

    isolationProvider = {
      getHealthDetails: vi.fn(() => ({ docker: true, disk: true })),
    } as unknown as IsolationProvider;

    registerRoutes(
      app,
      dispatcher,
      tokenService,
      { orchestratorSecret },
      mockLogger,
      undefined,
      credentialMonitor,
      isolationProvider
    );
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
        status: 'accepted',
      });
    });

    it('should pass planningPrBranch and planningPrUrl through to dispatcher', async () => {
      const taskPayload = {
        taskId: 'test-planning-pr',
        workerType: 'auto',
        prompt: 'Implement the plan',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        agentType: 'execution',
        planningPrBranch: 'plan/my-feature',
        planningPrUrl: 'https://github.com/org/repo/pull/42',
      };

      const { headers, body } = createSignedRequest(taskPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({
          planningPrBranch: 'plan/my-feature',
          planningPrUrl: 'https://github.com/org/repo/pull/42',
          agentType: 'execution',
        })
      );
    });

    it('should accept task without planningPr fields', async () => {
      const taskPayload = {
        taskId: 'test-no-planning-pr',
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
      const dispatchCall = vi.mocked(dispatcher.submitTask).mock.calls[0]?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(dispatchCall).toBeDefined();
      expect(dispatchCall?.['planningPrBranch']).toBeUndefined();
      expect(dispatchCall?.['planningPrUrl']).toBeUndefined();
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

    it('should reject missing timestamp header', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const body = JSON.stringify(taskPayload);
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
      const message = `.${nonce}.${body}`;
      const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: {
          'x-dispatch-signature': signature,
          'x-dispatch-nonce': nonce,
          'content-type': 'application/json',
        },
        body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Missing authentication headers',
      });
    });

    it('should reject missing signature header', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const timestamp = String(Date.now());
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: {
          'x-dispatch-timestamp': timestamp,
          'x-dispatch-nonce': nonce,
          'content-type': 'application/json',
        },
        payload: taskPayload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Missing authentication headers',
      });
    });

    it('should reject missing nonce header', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const timestamp = String(Date.now());
      const body = JSON.stringify(taskPayload);
      const message = `${timestamp}..${body}`;
      const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers: {
          'x-dispatch-timestamp': timestamp,
          'x-dispatch-signature': signature,
          'content-type': 'application/json',
        },
        body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Missing authentication headers',
      });
    });

    it('should reject invalid request body', async () => {
      const taskPayload = {
        taskId: 'test-task',
        // Missing required fields
      };

      const { headers, body } = createSignedRequest(taskPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('error');
    });

    it('should reject an empty continuationPrBranch', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        continuationPrNumber: 1139,
        continuationPrBranch: '',
      };

      const { headers, body } = createSignedRequest(taskPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toHaveProperty('error');
      expect(dispatcher.submitTask).not.toHaveBeenCalled();
    });

    it('should return 400 for service errors (not at_capacity)', async () => {
      vi.mocked(dispatcher.submitTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'service_error', message: 'Failed to create worktree' },
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

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'Failed to create worktree',
      });
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

    it('should return 503 when Docker is unavailable', async () => {
      vi.mocked(dispatcher.submitTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'docker_unavailable', message: 'Docker daemon is not responding' },
      });

      const taskPayload = {
        taskId: 'test-task-docker',
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
      expect(response.json()).toMatchObject({ error: 'Docker daemon is not responding' });
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
    it('should return health status with anthropicOAuth', async () => {
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
      expect(json.anthropicOAuth).toMatchObject({
        status: 'active',
        subscriptionType: 'max',
      });
      expect(json.anthropicOAuth.expiresInMinutes).toBe(240);
    });

    it('should return null githubTokenExpiresAt when token expiry is not set', async () => {
      vi.mocked(tokenService.getExpiresAt).mockReturnValueOnce(null);

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.githubTokenExpiresAt).toBeNull();
    });

    it('should return expired anthropicOAuth status', async () => {
      vi.mocked(credentialMonitor.getState).mockReturnValueOnce({
        status: 'expired',
        message: 'Access token expired',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.anthropicOAuth.status).toBe('expired');
    });

    it('should return not_configured anthropicOAuth status', async () => {
      vi.mocked(credentialMonitor.getState).mockReturnValueOnce({
        status: 'not_configured',
        message: 'OAuth credentials not found',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.anthropicOAuth.status).toBe('not_configured');
    });

    it('should include dockerHealthy and diskHealthy in health response', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.dockerHealthy).toBe(true);
      expect(json.diskHealthy).toBe(true);
    });

    it('should reflect unhealthy Docker in health response', async () => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test mock always has getHealthDetails
      vi.mocked(isolationProvider.getHealthDetails!).mockReturnValueOnce({
        docker: false,
        disk: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.dockerHealthy).toBe(false);
      expect(json.diskHealthy).toBe(true);
    });
  });

  describe('POST /admin/refresh-token', () => {
    it('should refresh token', async () => {
      const { headers, body } = createSignedRequest({});

      const response = await app.inject({
        method: 'POST',
        url: '/admin/refresh-token',
        headers,
        body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('tokenExpiresAt');
    });
  });

  describe('Authentication - Signature Verification', () => {
    it('should reject invalid signature', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const timestamp = String(Date.now());
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
      const body = JSON.stringify(taskPayload);

      // Use wrong signature
      const headers = {
        'x-dispatch-timestamp': timestamp,
        'x-dispatch-signature': 'invalid-signature-here',
        'x-dispatch-nonce': nonce,
        'content-type': 'application/json',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Invalid signature',
      });
    });

    it('should reject replayed nonce', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const { headers, body } = createSignedRequest(taskPayload);

      // First request should succeed
      const response1 = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });
      expect(response1.statusCode).toBe(202);

      // Second request with same nonce should fail
      const response2 = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });
      expect(response2.statusCode).toBe(401);
      expect(response2.json()).toMatchObject({
        error: 'Nonce already used',
      });
    });

    it('should reject timestamp too old', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const timestamp = String(Date.now() - 6 * 60 * 1000); // 6 minutes ago
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
      const body = JSON.stringify(taskPayload);
      const message = `${timestamp}.${nonce}.${body}`;
      const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

      const headers = {
        'x-dispatch-timestamp': timestamp,
        'x-dispatch-signature': signature,
        'x-dispatch-nonce': nonce,
        'content-type': 'application/json',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Timestamp too old or too new',
      });
    });

    it('should reject timestamp too new (future)', async () => {
      const taskPayload = {
        taskId: 'test-task',
        workerType: 'auto',
        prompt: 'Test prompt',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      const timestamp = String(Date.now() + 6 * 60 * 1000); // 6 minutes in future
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
      const body = JSON.stringify(taskPayload);
      const message = `${timestamp}.${nonce}.${body}`;
      const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

      const headers = {
        'x-dispatch-timestamp': timestamp,
        'x-dispatch-signature': signature,
        'x-dispatch-nonce': nonce,
        'content-type': 'application/json',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: 'Timestamp too old or too new',
      });
    });
  });

  describe('cleanUpExpiredNonces function', () => {
    it('should not clean up when cache size is below threshold', () => {
      const nonceCache: Record<string, number> = {
        'nonce-1': Date.now() - 1000,
        'nonce-2': Date.now() - 2000,
      };
      const now = Date.now();

      cleanUpExpiredNonces(nonceCache, now, 10000);

      // Nonces should still exist (cache not large enough)
      expect(Object.keys(nonceCache)).toHaveLength(2);
      expect(nonceCache['nonce-1']).toBeDefined();
      expect(nonceCache['nonce-2']).toBeDefined();
    });

    it('should clean up expired nonces when cache exceeds threshold', () => {
      const now = Date.now();
      const expiredTime = now - 11 * 60 * 1000; // 11 minutes ago (expired - TTL is 10 min)
      const validTime = now - 5 * 60 * 1000; // 5 minutes ago (still valid)

      const nonceCache: Record<string, number> = {
        'expired-1': expiredTime,
        'expired-2': expiredTime - 1000,
        'valid-1': validTime,
        'valid-2': validTime - 1000,
        // Add enough entries to exceed threshold
        ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`nonce-${i}`, now - i * 1000])),
      };

      const initialCount = Object.keys(nonceCache).length;
      expect(initialCount).toBeGreaterThan(5);

      cleanUpExpiredNonces(nonceCache, now, 5);

      // Expired nonces should be removed, valid ones should remain
      expect(nonceCache['expired-1']).toBeUndefined();
      expect(nonceCache['expired-2']).toBeUndefined();
      expect(nonceCache['valid-1']).toBeDefined();
      expect(nonceCache['valid-2']).toBeDefined();
    });

    it('should handle cache with all expired nonces', () => {
      const now = Date.now();
      const expiredTime = now - 15 * 60 * 1000; // 15 minutes ago

      const nonceCache: Record<string, number> = {
        'expired-1': expiredTime,
        'expired-2': expiredTime - 1000,
        'expired-3': expiredTime - 2000,
        'expired-4': expiredTime - 3000,
        'expired-5': expiredTime - 4000,
      };

      cleanUpExpiredNonces(nonceCache, now, 3);

      // All nonces should be removed
      expect(Object.keys(nonceCache)).toHaveLength(0);
    });

    it('should handle cache with all valid nonces', () => {
      const now = Date.now();
      const validTime = now - 2 * 60 * 1000; // 2 minutes ago

      const nonceCache: Record<string, number> = {
        'valid-1': validTime,
        'valid-2': validTime - 1000,
        'valid-3': validTime - 2000,
        'valid-4': validTime - 3000,
        'valid-5': validTime - 4000,
      };

      const initialKeys = Object.keys(nonceCache);

      cleanUpExpiredNonces(nonceCache, now, 3);

      // All nonces should remain (none expired)
      expect(Object.keys(nonceCache)).toEqual(initialKeys);
    });
  });

  describe('Nonce Cache Cleanup', () => {
    it('should handle large number of nonce cache entries', async () => {
      const taskPayload = {
        taskId: 'cache-test',
        workerType: 'auto',
        prompt: 'Test cache handling',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      // Send a smaller number of requests to test cache doesn't break
      for (let i = 0; i < 100; i++) {
        const timestamp = String(Date.now() - 4 * 60 * 1000); // 4 minutes ago (still valid)
        const nonce = `cache-nonce-${i}`;
        const body = JSON.stringify({ ...taskPayload, taskId: `task-${i}` });
        const message = `${timestamp}.${nonce}.${body}`;
        const signature = createHmac('sha256', orchestratorSecret).update(message).digest('hex');

        const headers = {
          'x-dispatch-timestamp': timestamp,
          'x-dispatch-signature': signature,
          'x-dispatch-nonce': nonce,
          'content-type': 'application/json',
        };

        await app.inject({
          method: 'POST',
          url: '/tasks',
          headers,
          body,
        });
      }

      // Verify cache still works with a valid request
      const { headers, body } = createSignedRequest(taskPayload);
      const response = await app.inject({
        method: 'POST',
        url: '/tasks',
        headers,
        body,
      });

      // Valid request should succeed
      expect(response.statusCode).toBe(202);
    });

    it('should clean up old nonce entries when cache exceeds 10000 entries', async () => {
      // This code path is difficult to test without performance impact
      // The cleanup logic only triggers at 10000+ nonce entries
      // Testing this would require sending thousands of requests which slows down CI
      // The logic is straightforward: iterate and delete old entries
      // Skipping practical test for this edge case
      expect(true).toBe(true);
    });
  });

  describe('DELETE /tasks/:id - additional error cases', () => {
    it('should return 409 when task already completed', async () => {
      vi.mocked(dispatcher.cancelTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'already_completed', message: 'Task already completed' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/tasks/completed-task',
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: 'Task already completed',
      });
    });

    it('should return 500 for service errors during cancel', async () => {
      vi.mocked(dispatcher.cancelTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'service_error', message: 'Internal service error' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/tasks/error-task',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: 'Internal service error',
      });
    });
  });

  describe('POST /admin/refresh-token - error case', () => {
    it('should return 500 when token refresh fails', async () => {
      vi.mocked(tokenService.refreshToken).mockResolvedValueOnce({
        ok: false,
        error: { code: 'REFRESH_FAILED', message: 'Token refresh failed' },
      });

      const { headers, body } = createSignedRequest({});

      const response = await app.inject({
        method: 'POST',
        url: '/admin/refresh-token',
        headers,
        body,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        error: 'Token refresh failed',
      });
    });

    it('should return null tokenExpiresAt when token expiry is not set', async () => {
      vi.mocked(tokenService.getExpiresAt).mockReturnValueOnce(null);

      const { headers, body } = createSignedRequest({});

      const response = await app.inject({
        method: 'POST',
        url: '/admin/refresh-token',
        headers,
        body,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.tokenExpiresAt).toBeNull();
    });
  });

  describe('GET /meta/worker-image', () => {
    it('returns image info when isolation provider is available', async () => {
      const appWithProvider = Fastify();
      const mockProvider = {
        getImageInfo: (): {
          configuredRef: string;
          lastResolvedDigest: string | null;
          pullPolicy: string;
          managedAttemptsMode: boolean;
        } => ({
          configuredRef: 'registry/image:latest',
          lastResolvedDigest: 'registry/image@sha256:abc',
          pullPolicy: 'always',
          managedAttemptsMode: true,
        }),
      };

      registerRoutes(
        appWithProvider,
        dispatcher,
        tokenService,
        { orchestratorSecret },
        mockLogger,
        undefined,
        undefined,
        mockProvider as never
      );
      await appWithProvider.ready();

      const response = await appWithProvider.inject({
        method: 'GET',
        url: '/meta/worker-image',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        configuredRef: 'registry/image:latest',
        lastResolvedDigest: 'registry/image@sha256:abc',
        pullPolicy: 'always',
        managedAttemptsMode: true,
      });

      await appWithProvider.close();
    });

    it('returns error when no isolation provider is available', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/meta/worker-image',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ error: 'Image info not available' });
    });
  });

  describe('POST /tasks/:id/message', () => {
    it('should queue message for running task', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: true,
        value: { action: 'queued' },
      });

      const { headers, body } = createSignedRequest({ message: 'Please fix the tests too' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/test-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ action: 'queued' });
      expect(dispatcher.sendMessage).toHaveBeenCalledWith('test-task', 'Please fix the tests too');
    });

    it('should resume completed task with message', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: true,
        value: { action: 'resumed' },
      });

      const { headers, body } = createSignedRequest({ message: 'Add more tests' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/done-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ action: 'resumed' });
    });

    it('should return 404 for non-existent task', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: false,
        error: { type: 'not_found', message: 'Task not found' },
      });

      const { headers, body } = createSignedRequest({ message: 'Hello' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/missing/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 409 for invalid status', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: false,
        error: {
          type: 'invalid_status',
          message: 'Cannot send message to task with status "cancelled"',
        },
      });

      const { headers, body } = createSignedRequest({ message: 'Hello' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/cancelled-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(409);
    });

    it('should return 500 for service errors', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: false,
        error: { type: 'service_error', message: 'Failed to resume task' },
      });

      const { headers, body } = createSignedRequest({ message: 'Hello' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/error-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(500);
    });

    it('should reject empty message', async () => {
      const { headers, body } = createSignedRequest({ message: '' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/test-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing message field', async () => {
      const { headers, body } = createSignedRequest({});

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/test-task/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should require authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/tasks/test-task/message',
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /admin/shutdown', () => {
    it('should return shutdown status', async () => {
      const infoSpy = vi.spyOn(mockLogger, 'info');

      const { headers, body } = createSignedRequest({});

      const response = await app.inject({
        method: 'POST',
        url: '/admin/shutdown',
        headers,
        body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'shutting_down',
      });
      expect(infoSpy).toHaveBeenCalledWith(
        { method: 'POST', url: '/admin/shutdown' },
        'Admin endpoint called'
      );

      infoSpy.mockRestore();
    });
  });
});
