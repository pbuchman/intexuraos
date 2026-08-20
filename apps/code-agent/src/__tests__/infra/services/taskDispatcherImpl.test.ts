/**
 * Tests for taskDispatcherImpl.ts v8 ignore blocks.
 *
 * Covers: extractErrorMessage, HMAC signing failure in sendMessageToWorker,
 * non-OK responses in sendMessageToWorker, and non-OK responses in cancelOnWorker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import type { TaskDispatcherDeps } from '../../../domain/services/taskDispatcher.js';
import type { WorkerHealthState } from '../../../domain/models/workerSettings.js';
import type { Logger } from '@intexuraos/common-core';

const WORKER_URL = 'https://test-worker.example.com';
const HEALTHY_WORKER_DETAILS = {
  workerAuths: {
    claude: { status: 'active' },
    codex: { status: 'active' },
  },
  providerApiKeys: {
    MINIMAX_API_KEY: { configured: true },
    MIMO_API_KEY: { configured: true },
    DASHSCOPE_API_KEY: { configured: true },
    KIMI_API_KEY: { configured: true },
    OPENROUTER_API_KEY: { configured: true },
  },
  dockerHealthy: true,
  diskHealthy: true,
} satisfies Pick<
  Extract<WorkerHealthState, { _tag: 'healthy' }>,
  'workerAuths' | 'providerApiKeys' | 'dockerHealthy' | 'diskHealthy'
>;

const workerCredentials = {
  url: WORKER_URL,
  cfAccessClientId: 'test-client-id',
  cfAccessClientSecret: 'test-client-secret',
  dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
};

describe('taskDispatcherImpl', () => {
  let logger: Logger;
  let deps: TaskDispatcherDeps;

  beforeEach(() => {
    nock.cleanAll();

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    deps = {
      logger,
      workerHealthProbe: {
        probeWorker: vi.fn(),
        probeAllWorkers: vi.fn(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('extractErrorMessage (via sendMessageToWorker non-OK response)', () => {
    it('extracts error from JSON response body', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-123/message')
        .reply(400, { error: 'Invalid task state' });

      const result = await service.sendMessageToWorker(
        'task-123',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('Invalid task state');
        expect(result.error.message).toContain('400');
      }
    });

    it('uses plain text when response body is not JSON', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-456/message')
        .reply(400, 'Plain text error response');

      const result = await service.sendMessageToWorker(
        'task-456',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('Plain text error response');
        expect(result.error.message).toContain('400');
      }
    });

    it('uses raw text when JSON has no error field', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-789/message')
        .reply(422, JSON.stringify({ detail: 'not the error field' }));

      const result = await service.sendMessageToWorker(
        'task-789',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        // parsed.error is undefined (key absent), so extractErrorMessage falls through to raw text
        expect(result.error.message).toContain('422');
        expect(result.error.message).toContain('not the error field');
      }
    });
  });

  describe('sendMessageToWorker HMAC signing failure', () => {
    it('returns signing_failed when dispatchSigningSecret is empty', async () => {
      const service = createTaskDispatcherService(deps);

      const result = await service.sendMessageToWorker(
        'task-signing-fail',
        'test message',
        {
          ...workerCredentials,
          dispatchSigningSecret: '',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('signing_failed');
        expect(result.error.message).toContain('Failed to sign message request');
      }
    });
  });

  describe('sendMessageToWorker success path', () => {
    it('returns action data when worker responds with OK status', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-success/message')
        .reply(200, { action: 'queued' });

      const result = await service.sendMessageToWorker(
        'task-success',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }
    });
  });

  describe('sendMessageToWorker non-OK response handling', () => {
    it('returns worker_unavailable for retryable infrastructure status 503', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-503/message')
        .reply(503, 'Service Unavailable');

      const result = await service.sendMessageToWorker(
        'task-503',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('503');
      }
    });

    it('returns worker_unavailable for retryable infrastructure status 502', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-502/message')
        .reply(502, 'Bad Gateway');

      const result = await service.sendMessageToWorker(
        'task-502',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('502');
      }
    });

    it('returns worker_unavailable for Cloudflare status 520', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-520/message')
        .reply(520, 'Cloudflare Error');

      const result = await service.sendMessageToWorker(
        'task-520',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('520');
      }
    });

    it('returns worker_error for non-retryable status 400', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-400/message')
        .reply(400, { error: 'Bad Request' });

      const result = await service.sendMessageToWorker(
        'task-400',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('Bad Request');
      }
    });

    it('returns session_expired for HTTP 410 Gone', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-410/message')
        .reply(410, { error: 'Session has expired — the worker container was cleaned up.' });

      const result = await service.sendMessageToWorker(
        'task-410',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('session_expired');
        expect(result.error.message).toContain('Session has expired');
      }
    });

    it('returns session_expired with default message when HTTP 410 has empty body', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks/task-410-empty/message')
        .reply(410, '');

      const result = await service.sendMessageToWorker(
        'task-410-empty',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('session_expired');
        expect(result.error.message).toBe('Session has expired — the worker container was cleaned up.');
      }
    });
  });

  describe('dispatch forwards timeoutHours (INT-1585)', () => {
    it('includes timeoutHours in worker dispatch payload when set', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      let capturedBody: Record<string, unknown> | undefined;
      nock(WORKER_URL)
        .post('/tasks', (body: Record<string, unknown>) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        taskId: 'task-timeout-set',
        prompt: 'Long task',
        systemPromptHash: 'hash-123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
        timeoutHours: 8,
      });

      expect(result.ok).toBe(true);
      expect(capturedBody).toBeDefined();
      expect(capturedBody?.['timeoutHours']).toBe(8);
    });

    it('omits timeoutHours from dispatch payload when absent (backward compat)', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      let capturedBody: Record<string, unknown> | undefined;
      nock(WORKER_URL)
        .post('/tasks', (body: Record<string, unknown>) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        taskId: 'task-timeout-absent',
        prompt: 'Default-timeout task',
        systemPromptHash: 'hash-123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(result.ok).toBe(true);
      expect(capturedBody).toBeDefined();
      expect('timeoutHours' in (capturedBody ?? {})).toBe(false);
    });
  });

  describe('dispatch includes reviewTypes when provided', () => {
    it('sends reviewTypes in the dispatch request body', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      let capturedBody: Record<string, unknown> | undefined;
      nock(WORKER_URL)
        .post('/tasks', (body: Record<string, unknown>) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        taskId: 'task-review-types',
        prompt: 'Review PR',
        systemPromptHash: 'hash-123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'opus',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: [],
        hasChildren: false,
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
        reviewTypes: ['code_quality', 'security'],
      });

      expect(result.ok).toBe(true);
      expect(capturedBody).toBeDefined();
      expect(capturedBody?.['reviewTypes']).toEqual(['code_quality', 'security']);
    });
  });

  describe('dispatch includes Sentry issue context when provided', () => {
    it('sends sentryIssue in the dispatch request body', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);
      const sentryIssue = {
        organizationSlug: 'intexura',
        projectSlug: 'code-agent',
        projectId: '42',
        issueId: '123456',
        issueShortId: 'CODE-AGENT-1',
        issueUrl: 'https://intexura.sentry.io/issues/123456/',
        title: 'TypeError: Cannot read properties of undefined',
        action: 'created',
        receivedAt: '2026-06-28T12:00:00.000Z',
        eventId: 'event-1',
      };

      let capturedBody: Record<string, unknown> | undefined;
      nock(WORKER_URL)
        .post('/tasks', (body: Record<string, unknown>) => {
          capturedBody = body;
          return true;
        })
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        taskId: 'task-sentry-context',
        prompt: 'Fix Sentry issue',
        systemPromptHash: 'hash-123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'codex-xhigh',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: 'secret',
        linearIssueLabels: ['sentry', 'code-task'],
        hasChildren: false,
        agentType: 'sentry',
        sentryIssue,
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(result.ok).toBe(true);
      expect(capturedBody).toBeDefined();
      expect(capturedBody?.['sentryIssue']).toEqual(sentryIssue);
    });
  });

  describe('dispatch non-OK response handling', () => {
    it('returns dispatch_failed with worker error message for non-retryable status 400', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks')
        .reply(400, { error: 'String must contain at least 1 character(s)' });

      const result = await service.dispatch({
        taskId: 'task-validation-failure',
        prompt: 'Fix CI',
        systemPromptHash: 'hash-123',
        repository: 'test/repo',
        baseBranch: 'main',
        workerType: 'codex',
        webhookUrl: 'https://example.com/webhook',
        webhookSecret: '',
        linearIssueLabels: [],
        hasChildren: false,
        agentType: 'pull_request',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('dispatch_failed');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('String must contain at least 1 character(s)');
      }
    });
  });

  describe('dispatch blocker metadata', () => {
    const baseRequest = {
      taskId: 'task-blocked',
      prompt: 'Fix CI',
      systemPromptHash: 'hash-123',
      repository: 'test/repo',
      baseBranch: 'main',
      workerType: 'opus' as const,
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: [],
      hasChildren: false,
    };

    it('returns a no-enabled-workers blocker when no worker credentials are configured', async () => {
      const service = createTaskDispatcherService(deps);

      const result = await service.dispatch({
        ...baseRequest,
        workerCredentials: { workers: [] },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.blocker?.reason).toBe('no_enabled_workers');
      }
    });

    it('returns at_capacity when every capable worker is full', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 2,
          available: 0,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });
      const service = createTaskDispatcherService(deps);

      const result = await service.dispatch({
        ...baseRequest,
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('at_capacity');
        expect(result.error.blocker?.reason).toBe('workers_at_capacity');
      }
    });

    it('skips Sentry capture when blocker reason is workers_at_capacity', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 2,
          available: 0,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });
      const service = createTaskDispatcherService(deps);

      await service.dispatch({
        ...baseRequest,
        taskId: 'task-at-capacity',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-at-capacity',
          reason: 'workers_at_capacity',
          _skipSentry: true,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('skips Sentry capture when blocker reason is a critical capability condition', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'connection refused',
        },
      });
      const service = createTaskDispatcherService(deps);

      await service.dispatch({
        ...baseRequest,
        taskId: 'task-unreachable',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-unreachable',
          reason: 'workers_unreachable',
          _skipSentry: true,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('skips Sentry capture when intentionally unavailable Codex auth blocks dispatch', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
          workerAuths: {
            ...HEALTHY_WORKER_DETAILS.workerAuths,
            codex: { status: 'expired', refreshSupported: false, message: 'Codex token expired' },
          },
        },
      });
      const service = createTaskDispatcherService(deps);

      await service.dispatch({
        ...baseRequest,
        taskId: 'task-codex-auth',
        workerType: 'codex-xhigh',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-codex-auth',
          reason: 'codex_auth_unavailable',
          _skipSentry: true,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('keeps an incompatible worker health contract visible in Sentry', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'unknown',
          healthy: false,
          error: 'Health response missing worker capability details',
          contractMismatch: true,
          missingFields: ['workerAuths'],
        },
      });
      const service = createTaskDispatcherService(deps);

      await service.dispatch({
        ...baseRequest,
        taskId: 'task-contract-mismatch',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-contract-mismatch',
          reason: 'worker_health_contract_mismatch',
          _skipSentry: false,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('keeps malformed worker health responses visible in Sentry', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'default': {
          _tag: 'unknown',
          healthy: false,
          error: 'Invalid health response format',
        },
      });
      const service = createTaskDispatcherService(deps);

      await service.dispatch({
        ...baseRequest,
        taskId: 'task-invalid-health',
        workerCredentials: {
          workers: [{
            name: 'default',
            url: WORKER_URL,
            cfAccessClientId: 'test-client-id',
            cfAccessClientSecret: 'test-client-secret',
            dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
          }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-invalid-health',
          reason: 'workers_unreachable',
          _skipSentry: false,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('keeps malformed health visible when another worker produces an auth blocker', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'malformed': {
          _tag: 'unknown',
          healthy: false,
          error: 'Invalid health response format',
        },
        'healthy': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
          workerAuths: {
            ...HEALTHY_WORKER_DETAILS.workerAuths,
            codex: { status: 'not_configured' },
          },
        },
      });
      const service = createTaskDispatcherService(deps);

      const result = await service.dispatch({
        ...baseRequest,
        taskId: 'task-mixed-auth-health',
        workerType: 'codex-xhigh',
        workerCredentials: {
          workers: [
            {
              name: 'malformed',
              url: 'https://malformed-worker.example.com',
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
            {
              name: 'healthy',
              url: WORKER_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
          ],
        },
      });

      expect(result.ok).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-mixed-auth-health',
          reason: 'codex_auth_unavailable',
          unexpectedWorkerHealth: [expect.objectContaining({ workerName: 'malformed', tag: 'unknown' })],
          _skipSentry: false,
        }),
        'Dispatch blocked by worker capability or health state'
      );
    });

    it('reports malformed health even when another worker can dispatch the task', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'malformed': {
          _tag: 'unknown',
          healthy: false,
          error: 'Invalid health response format',
        },
        'healthy': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });
      nock(WORKER_URL)
        .post('/tasks')
        .reply(200, { status: 'accepted' });
      const service = createTaskDispatcherService(deps);

      const result = await service.dispatch({
        ...baseRequest,
        taskId: 'task-mixed-dispatchable-health',
        workerCredentials: {
          workers: [
            {
              name: 'malformed',
              url: 'https://malformed-worker.example.com',
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
            {
              name: 'healthy',
              url: WORKER_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-mixed-dispatchable-health',
          reason: 'unexpected_worker_health_response',
          unexpectedWorkerHealth: [expect.objectContaining({ workerName: 'malformed', tag: 'unknown' })],
          _skipSentry: false,
        }),
        'Worker health probe returned an unexpected response'
      );
    });
  });

  describe('failedWorkerLocation filtering', () => {
    const WORKER_B_URL = 'https://worker-b.example.com';

    const baseDispatchRequest = {
      prompt: 'Do something',
      systemPromptHash: 'hash-abc',
      repository: 'test/repo',
      baseBranch: 'main',
      workerType: 'opus' as const,
      webhookUrl: 'https://example.com/webhook',
      webhookSecret: 'secret',
      linearIssueLabels: [],
      hasChildren: false,
    };

    it('excludes the failed worker when alternatives exist', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'worker-a': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
        'worker-b': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      // Only intercept worker-b — if dispatcher hits worker-a the request will be unmatched
      nock(WORKER_B_URL)
        .post('/tasks')
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        ...baseDispatchRequest,
        taskId: 'task-exclude-failed',
        failedWorkerLocation: 'worker-a',
        workerCredentials: {
          workers: [
            {
              name: 'worker-a',
              url: WORKER_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
            {
              name: 'worker-b',
              url: WORKER_B_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('worker-b');
      }
    });

    it('falls back to failed worker when it is the only healthy option', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'worker-a': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks')
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        ...baseDispatchRequest,
        taskId: 'task-fallback-failed',
        failedWorkerLocation: 'worker-a',
        workerCredentials: {
          workers: [
            {
              name: 'worker-a',
              url: WORKER_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('worker-a');
      }
    });

    it('dispatches normally when failedWorkerLocation is undefined', async () => {
      const probeAllWorkers = deps.workerHealthProbe.probeAllWorkers as ReturnType<typeof vi.fn>;
      probeAllWorkers.mockResolvedValueOnce({
        'worker-a': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 0,
          available: 2,
          responseTimeMs: 50,
          ...HEALTHY_WORKER_DETAILS,
        },
      });

      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .post('/tasks')
        .reply(200, { status: 'accepted' });

      const result = await service.dispatch({
        ...baseDispatchRequest,
        taskId: 'task-no-failed-location',
        workerCredentials: {
          workers: [
            {
              name: 'worker-a',
              url: WORKER_URL,
              cfAccessClientId: 'test-client-id',
              cfAccessClientSecret: 'test-client-secret',
              dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
            },
          ],
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerLocation).toBe('worker-a');
      }
    });
  });

  describe('cancelOnWorker success path', () => {
    it('completes successfully when worker returns OK status', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-cancel-ok')
        .reply(200, { status: 'cancelled' });

      await service.cancelOnWorker(
        'task-cancel-ok',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-cancel-ok', location: 'test-worker' }),
        'Worker cancellation request successful'
      );
    });
  });

  describe('cancelOnWorker non-OK response', () => {
    it('marks already-completed worker cancellation responses as expected for Sentry', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-already-complete')
        .reply(409, { error: 'Task already completed' });

      await service.cancelOnWorker(
        'task-already-complete',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-already-complete',
          location: 'test-worker',
          status: 409,
          _skipSentry: true,
        }),
        'Worker cancellation target already completed'
      );
    });

    it('rejects when worker returns a non-OK status', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-cancel-fail')
        .reply(500, 'Internal Server Error');

      await expect(service.cancelOnWorker(
        'task-cancel-fail',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      )).rejects.toThrow('Worker cancellation failed with HTTP 500');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-cancel-fail', location: 'test-worker', status: 500 }),
        'Worker cancellation request failed'
      );
    });

    it('rejects when the worker cannot find the task', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-not-found')
        .reply(404, 'Not Found');

      await expect(service.cancelOnWorker(
        'task-not-found',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      )).rejects.toThrow('Worker cancellation failed with HTTP 404');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-not-found', location: 'test-worker', status: 404 }),
        'Worker cancellation request failed'
      );
    });

    it('rejects before transport when worker credentials are unavailable', async () => {
      const service = createTaskDispatcherService(deps);

      await expect(service.cancelOnWorker(
        'task-no-credentials',
        'test-worker',
      )).rejects.toThrow('Worker cancellation credentials unavailable');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-no-credentials', location: 'test-worker' }),
        'No credentials provided for cancellation, skipping worker notification',
      );
    });

    it('rejects when cancellation transport fails', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-network-error')
        .replyWithError('socket reset');

      await expect(service.cancelOnWorker(
        'task-network-error',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        },
      )).rejects.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-network-error', location: 'test-worker' }),
        'Failed to notify worker of cancellation',
      );
    });
  });
});
