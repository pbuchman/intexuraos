/**
 * Tests for webhook endpoints
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { err, ok } from '@intexuraos/common-core';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient, type ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import crypto from 'node:crypto';
import { fetchWithAuth } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';

// Mock fetchWithAuth
vi.mock('@intexuraos/internal-clients', async () => ({
  fetchWithAuth: vi.fn(),
}));

describe('POST /internal/webhooks/task-complete', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let actionsAgentClient: ActionsAgentClient;
  let mockFetchWithAuth: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
    });
    const whatsappNotifier = createWhatsAppNotifier({
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
    });

    actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    mockFetchWithAuth = fetchWithAuth as ReturnType<typeof vi.fn>;
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      workerDiscovery,
      taskDispatcher,
      whatsappNotifier,
      actionsAgentClient,
      linearIssueService,
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  describe('authentication', () => {
    it('rejects request without X-Internal-Auth header', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects request with invalid X-Internal-Auth header', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'invalid-token',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('signature validation', () => {
    it('rejects request with missing signature', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('MISSING_SIGNATURE');
    });

    it('rejects request with expired timestamp', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Timestamp from 20 minutes ago
      const expiredTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': expiredTimestamp,
          'x-request-signature': 'signature',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('EXPIRED_SIGNATURE');
    });

    it('rejects request with invalid signature', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-request-signature': 'invalid-signature',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('accepts valid signed request', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Test summary',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
    });
  });

  describe('task status updates', () => {
    it('updates task status correctly for completed task', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 3,
          summary: 'Fixed the bug',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('completed');
      expect(getResult.value.result?.branch).toBe('test-branch');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores error for failed tasks', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('TEST_ERROR');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores error for interrupted tasks', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('interrupted');
      expect(getResult.value.error?.code).toBe('worker_interrupted');
      expect(getResult.value.callbackReceived).toBe(true);
    });
  });

  describe('actions-agent callback', () => {
    it('calls actions-agent when task has actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/action-123/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'completed',
            resource_result: {
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
            },
          }),
        })
      );
    });

    it('does not call actions-agent for tasks without actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        // No actionId
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify WhatsApp notification was sent (but not actions-agent)
      expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.any(Object),
        '/internal/messages/send',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('userId'),
        })
      );
    });

    it('calls actions-agent for completed task without prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-pr-less',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed but no PR',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called without prUrl
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/action-pr-less/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'completed',
          }),
        })
      );
    });

    it('calls actions-agent for failed task with actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-789',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'WORKER_ERROR',
          message: 'Worker failed to process task',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called with 'failed' status
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/action-789/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'failed',
            resource_result: {
              error: 'Worker failed to process task',
            },
          }),
        })
      );
    });

    it('handles task update failure gracefully', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-update-fail',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock task update to fail
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Completed but update fails',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'FIRESTORE_ERROR',
        },
      });

      updateSpy.mockRestore();
    });

    it('calls actions-agent for completed task without prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-456',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called with 'failed' status
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.any(Object),
        '/internal/actions/action-456/status',
        expect.objectContaining({
          body: JSON.stringify({
            resource_status: 'failed',
            resource_result: {
              error: 'Worker was interrupted during task execution',
            },
          }),
        })
      );
    });

    it('handles actions-agent failure gracefully', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-789',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      // Mock actions-agent failure
      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Connection refused',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Webhook still succeeds even though actions-agent callback failed
      expect(response.statusCode).toBe(200);

      // Task was still updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('completed');
    });

    it('returns 500 when update fails for failed status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-fail-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock update to fail
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'FIRESTORE_ERROR' },
      });

      updateSpy.mockRestore();
    });

    it('returns 500 when update fails for interrupted status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-interrupt-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'FIRESTORE_ERROR' },
      });

      updateSpy.mockRestore();
    });

    it('continues when actions-agent fails for failed status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-fail-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      mockFetchWithAuth.mockResolvedValueOnce(
        err({ code: 'NETWORK_ERROR', message: 'Connection refused' })
      );

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Webhook succeeds even if actions-agent fails
      expect(response.statusCode).toBe(200);

      // Task was still updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
    });

    it('continues when actions-agent fails for interrupted status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-interrupt-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      mockFetchWithAuth.mockResolvedValueOnce(
        err({ code: 'NETWORK_ERROR', message: 'Connection refused' })
      );

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('interrupted');
    });
  });
});

describe('POST /internal/logs', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let logChunkRepo: LogChunkRepository;
  let taskDispatcher: TaskDispatcherService;

  beforeEach(async () => {
    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
    });
    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      workerDiscovery,
      taskDispatcher,
      actionsAgentClient,
      linearIssueService,
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      logChunkRepo: LogChunkRepository;
      workerDiscovery: WorkerDiscoveryService;
      taskDispatcher: TaskDispatcherService;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  it('stores log chunks correctly', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    // Mock storeBatch for log chunk storage
    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'First log line',
          timestamp: new Date().toISOString(),
        },
        {
          sequence: 2,
          content: 'Second log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.received).toBe(true);
  });

  it('validates HMAC signature', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-signature': 'invalid-signature',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('handles storeBatch failure', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    // Mock storeBatch to fail
    const storeSpy = vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
    );

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FIRESTORE_ERROR');

    storeSpy.mockRestore();
  });

  it('rejects logs for non-existent task', async () => {
    const payload = {
      taskId: 'non-existent-task-id',
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /internal/webhooks/task-complete - WhatsApp notifications', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let actionsAgentClient: ActionsAgentClient;
  let mockFetchWithAuth: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
    });
    const whatsappNotifier = createWhatsAppNotifier({
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
    });

    actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    mockFetchWithAuth = fetchWithAuth as ReturnType<typeof vi.fn>;
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      workerDiscovery,
      taskDispatcher,
      whatsappNotifier,
      actionsAgentClient,
      linearIssueService,
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  it('sends WhatsApp notification on task completion', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'fix/login-bug',
        commits: 3,
        summary: 'Fixed login redirect handling',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const whatsappCalls = mockFetchWithAuth.mock.calls.filter(
      (call) => call[1] === '/internal/messages/send'
    );
    expect(whatsappCalls.length).toBe(1);
    const firstCall = whatsappCalls[0];
    if (!firstCall) throw new Error('No WhatsApp calls');
    const body = JSON.parse(String(firstCall[2].body));
    expect(body.userId).toBe('user-123');
    expect(body.type).toBe('code_task_complete');
  });

  it('sends WhatsApp notification on task failure', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'failed' as const,
      error: {
        code: 'TEST_ERROR',
        message: 'Test error occurred',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const whatsappCalls = mockFetchWithAuth.mock.calls.filter(
      (call) => call[1] === '/internal/messages/send'
    );
    expect(whatsappCalls.length).toBe(1);
    const firstCall = whatsappCalls[0];
    if (!firstCall) throw new Error('No WhatsApp calls');
    const body = JSON.parse(String(firstCall[2].body));
    expect(body.userId).toBe('user-123');
    expect(body.type).toBe('code_task_failed');
  });

  it('does not send notification on interrupted status', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'interrupted' as const,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const whatsappCalls = mockFetchWithAuth.mock.calls.filter(
      (call) => call[1] === '/internal/messages/send'
    );
    expect(whatsappCalls.length).toBe(0);
  });

  it('continues even if WhatsApp notification fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'fix/login-bug',
        commits: 3,
        summary: 'Fixed login redirect handling',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    // Mock WhatsApp notification to fail
    mockFetchWithAuth.mockImplementationOnce(
      () => Promise.resolve(err({ code: 'NETWORK_ERROR', message: 'Connection failed', status: 503 }))
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    // Webhook should still succeed even if notification fails
    expect(response.statusCode).toBe(200);
  });
});
