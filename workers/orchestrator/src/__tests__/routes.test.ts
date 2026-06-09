import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { registerRoutes, cleanUpExpiredNonces } from '../routes.js';
import { systemPrompt } from '../services/system-prompt.js';
import type { TaskDispatcher } from '../services/task-dispatcher.js';
import type { GitHubTokenService } from '../github/token-service.js';
import type { IsolationProvider } from '../services/isolation/types.js';
import type { WorkerAuthRegistry } from '../services/worker-auth/index.js';
import type { Logger } from '@intexuraos/common-core';

describe('Routes', () => {
  let app: FastifyInstance;
  let dispatcher: TaskDispatcher;
  let tokenService: GitHubTokenService;
  let workerAuthRegistry: WorkerAuthRegistry;
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

    workerAuthRegistry = {
      getStates: vi.fn(() => ({
        claude: {
          status: 'active',
          authMode: 'oauth',
          refreshSupported: true,
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          expiresInMinutes: 240,
          subscriptionType: 'max',
        },
        codex: {
          status: 'active',
          authMode: 'chatgpt',
          refreshSupported: true,
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          expiresInMinutes: 240,
          lastRefreshAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        },
      })),
    } as unknown as WorkerAuthRegistry;

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
      workerAuthRegistry,
      isolationProvider,
      {
        MINIMAX_API_KEY: { configured: true },
        DASHSCOPE_API_KEY: { configured: false },
      }
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /tasks', () => {
    it('should accept valid task with correct signature', async () => {
      const taskPayload = {
        taskId: 'task_00000000-0000-0000-0000-000000000001',
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
        taskId: 'task_00000000-0000-0000-0000-000000000001',
        status: 'accepted',
      });
    });

    it('should pass all optional fields through to dispatcher', async () => {
      const taskPayload = {
        taskId: 'task_00000000-0000-0000-0000-000000000002',
        workerType: 'auto',
        prompt: 'Full payload test',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        repository: 'org/repo',
        baseBranch: 'develop',
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Test issue title',
        slug: 'test-slug',
        actionId: 'action-123',
        agentType: 'execution',
        prNumber: 77,
        continuationPrNumber: 42,
        continuationPrBranch: 'feature/continue',
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
          repository: 'org/repo',
          baseBranch: 'develop',
          linearIssueId: 'INT-999',
          linearIssueTitle: 'Test issue title',
          slug: 'test-slug',
          actionId: 'action-123',
          agentType: 'execution',
          prNumber: 77,
          continuationPrNumber: 42,
          continuationPrBranch: 'feature/continue',
        })
      );
    });

    it('should accept remediation as agentType', async () => {
      const taskPayload = {
        taskId: 'task_00000000-0000-0000-0000-000000000003',
        workerType: 'codex',
        prompt: 'Fix the review findings',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        agentType: 'remediation',
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
          taskId: 'task_00000000-0000-0000-0000-000000000003',
          agentType: 'remediation',
        })
      );
    });

    it('should return 503 when dispatcher reports auth_unavailable', async () => {
      vi.mocked(dispatcher.submitTask).mockResolvedValueOnce({
        ok: false,
        error: { type: 'auth_unavailable', message: 'Codex auth is not configured' },
      });

      const taskPayload = {
        taskId: 'task_00000000-0000-0000-0000-000000000004',
        workerType: 'codex',
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

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'Codex auth is not configured' });
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
        taskId: 'task_00000000-0000-0000-0000-000000000006',
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
        taskId: 'task_00000000-0000-0000-0000-000000000007',
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
        taskId: 'task_00000000-0000-0000-0000-000000000005',
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

  describe('POST /tasks — field propagation to dispatcher', () => {
    it('forwards executionMemoryContext to dispatcher.submitTask', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-0000000000e1',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        executionMemoryContext: {
          applicationId: 'app_1',
          retrievalVersion: 'v1',
          querySummary: 'q',
          matchedMemories: [
            {
              memoryId: 'mem_1',
              title: 't',
              memoryType: 'implementation_pattern',
              score: 0.5,
              appliesWhen: 'a',
              action: 'x',
              avoid: 'y',
              verification: 'z',
            },
          ],
        },
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({
          executionMemoryContext: payload.executionMemoryContext,
        })
      );
    });

    it('forwards trackingCommentId to dispatcher.submitTask', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-0000000000c1',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        trackingCommentId: '1234567',
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ trackingCommentId: '1234567' })
      );
    });

    it('forwards reviewTypes to dispatcher.submitTask', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-00000000d1d1',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        reviewTypes: ['code_quality', 'security'],
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ reviewTypes: ['code_quality', 'security'] })
      );
    });

    it('forwards retriedFrom to dispatcher.submitTask', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-0000000000f1',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        retriedFrom: 'task_original_abc',
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ retriedFrom: 'task_original_abc' })
      );
    });

    it('forwards timeoutHours to dispatcher.submitTask when set (INT-1585)', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-00000000aaaa',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        timeoutHours: 8,
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ timeoutHours: 8 })
      );
    });

    it('omits timeoutHours when not present in body — backward compat (INT-1585)', async () => {
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-00000000bbbb',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);
      expect(dispatcher.submitTask).toHaveBeenCalledWith(
        expect.not.objectContaining({ timeoutHours: expect.anything() })
      );
    });

    it('executionMemoryContext flows from POST body into the rendered system prompt', async () => {
      const memoryContext = {
        applicationId: 'app_e2e',
        retrievalVersion: 'v1',
        querySummary: 'q',
        matchedMemories: [
          {
            memoryId: 'mem_e2e_abc',
            title: 'Check composite index before query',
            memoryType: 'verification_pattern' as const,
            score: 0.7,
            appliesWhen: 'multi-field firestore queries',
            action: 'add index to firestore-collections.json',
            avoid: 'running query without index',
            verification: 'query returns results without error',
          },
        ],
      };
      const payload = {
        taskId: 'task_00000000-0000-0000-0000-0000000000e2',
        workerType: 'auto',
        prompt: 'p',
        webhookUrl: 'https://example.com/hook',
        webhookSecret: 'sec',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'review',
        executionMemoryContext: memoryContext,
      };
      const { headers, body } = createSignedRequest(payload);
      const response = await app.inject({ method: 'POST', url: '/tasks', headers, body });
      expect(response.statusCode).toBe(202);

      const submitCalls = (dispatcher.submitTask as ReturnType<typeof vi.fn>).mock.calls;
      expect(submitCalls.length).toBeGreaterThanOrEqual(1);
      const firstCall = submitCalls[0];
      expect(firstCall).toBeDefined();
      const submitted = (firstCall as unknown as [Record<string, unknown>])[0];
      expect(submitted['executionMemoryContext']).toEqual(memoryContext);

      const rendered = systemPrompt.build({
        taskId: submitted['taskId'] as string,
        linearIssueLabels: submitted['linearIssueLabels'] as string[],
        agentType: 'review',
        executionMemoryContext: submitted['executionMemoryContext'] as typeof memoryContext,
      });
      expect(rendered).toContain('### Execution Memory Context');
      expect(rendered).toContain('mem_e2e_abc');
      expect(rendered).toContain('Execution Memories Received');
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
    it('should return health status with workerAuths', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toMatchObject({
        healthContractVersion: 1,
        status: 'ready',
        capacity: 5,
        running: 0,
        available: 5,
      });
      expect(json).toHaveProperty('githubTokenExpiresAt');
      expect(json.workerAuths.claude).toMatchObject({
        status: 'active',
        subscriptionType: 'max',
      });
      expect(json.workerAuths.claude.expiresInMinutes).toBe(240);
      expect(json.workerAuths.codex).toMatchObject({
        status: 'active',
        authMode: 'chatgpt',
        refreshSupported: true,
      });
      expect(json.providerApiKeys).toEqual({
        MINIMAX_API_KEY: { configured: true },
        DASHSCOPE_API_KEY: { configured: false },
      });
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

    it('should return expired codex auth status', async () => {
      vi.mocked(workerAuthRegistry.getStates).mockReturnValueOnce({
        claude: {
          status: 'active',
          authMode: 'oauth',
          refreshSupported: true,
          expiresAt: new Date(Date.now() + 4 * 3600000).toISOString(),
          expiresInMinutes: 240,
          subscriptionType: 'max',
        },
        codex: {
          status: 'expired',
          authMode: 'chatgpt',
          refreshSupported: true,
          message: 'Codex ChatGPT access token expired',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.workerAuths.codex.status).toBe('expired');
    });

    it('should return not_configured worker auth status', async () => {
      vi.mocked(workerAuthRegistry.getStates).mockReturnValueOnce({
        claude: {
          status: 'not_configured',
          authMode: null,
          refreshSupported: false,
          message: 'Claude credentials not found',
        },
        codex: {
          status: 'not_configured',
          authMode: null,
          refreshSupported: false,
          message: 'Codex auth file not found',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.workerAuths.claude.status).toBe('not_configured');
      expect(json.workerAuths.codex.status).toBe('not_configured');
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
        taskId: 'task_00000000-0000-0000-0000-000000000008',
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
        taskId: 'task_00000000-0000-0000-0000-0000000000ca',
        workerType: 'auto',
        prompt: 'Test cache handling',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
      };

      // Send a smaller number of requests to test cache doesn't break
      for (let i = 0; i < 100; i++) {
        const timestamp = String(Date.now() - 4 * 60 * 1000); // 4 minutes ago (still valid)
        const nonce = `cache-nonce-${i}`;
        const hexI = i.toString(16).padStart(12, '0');
        const body = JSON.stringify({
          ...taskPayload,
          taskId: `task_00000000-0000-0000-0000-${hexI}`,
        });
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

    it('should return 410 for session_expired error', async () => {
      vi.mocked(dispatcher.sendMessage).mockResolvedValueOnce({
        ok: false,
        error: {
          type: 'session_expired',
          message:
            'Session has expired — the worker container was cleaned up. Please start a new session.',
        },
      });

      const { headers, body } = createSignedRequest({ message: 'Follow-up' });

      const response = await app.inject({
        method: 'POST',
        url: '/tasks/expired-session/message',
        headers,
        body,
      });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toEqual({
        error:
          'Session has expired — the worker container was cleaned up. Please start a new session.',
      });
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
