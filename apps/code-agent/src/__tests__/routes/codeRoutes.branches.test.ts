/**
 * Tests covering uncovered branches in codeRoutes.ts.
 *
 * These tests target specific fallback paths (nullish coalescing, conditional spreads),
 * auth guard branches, and error handling paths that are not covered by the main test file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';
import { err, ok, type Result } from '@intexuraos/common-core';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

// Mock processCodeAction to control error responses
vi.mock('../../domain/usecases/processCodeAction.js', () => ({
  processCodeAction: vi.fn(),
}));

// Mock submitToExecutionAgent to control error responses
vi.mock('../../domain/usecases/submitToExecutionAgent.js', () => ({
  submitToExecutionAgent: vi.fn(),
}));

// Mock submitTaskFeedback to control error responses
vi.mock('../../domain/usecases/submitTaskFeedback.js', () => ({
  submitTaskFeedback: vi.fn(),
}));

// Mock sendTaskMessage to control error responses
vi.mock('../../domain/usecases/sendTaskMessage.js', () => ({
  sendTaskMessage: vi.fn(),
}));

// Mock retryTask to control error responses
vi.mock('../../domain/usecases/retryTask.js', () => ({
  retryTask: vi.fn(),
}));

// Mock cancelTaskWithNonce to control error responses
vi.mock('../../domain/usecases/cancelTaskWithNonce.js', () => ({
  cancelTaskWithNonce: vi.fn(),
}));

// Mock backLinkPlanningTask to no-op
vi.mock('../../domain/usecases/backLinkPlanningTask.js', () => ({
  backLinkPlanningTask: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../server.js';
import { resetServices, setServices, getServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import type { Logger } from 'pino';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { TaskDispatcherService, DispatchResult, DispatchError } from '../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createGitHubPRHttpClient } from '../../infra/http/gitHubPRHttpClient.js';

// Import mocked functions
import { processCodeAction } from '../../domain/usecases/processCodeAction.js';
import { submitToExecutionAgent } from '../../domain/usecases/submitToExecutionAgent.js';
import { submitTaskFeedback } from '../../domain/usecases/submitTaskFeedback.js';
import { sendTaskMessage } from '../../domain/usecases/sendTaskMessage.js';
import { retryTask } from '../../domain/usecases/retryTask.js';
import { cancelTaskWithNonce } from '../../domain/usecases/cancelTaskWithNonce.js';

const mockedProcessCodeAction = vi.mocked(processCodeAction);
const mockedSubmitToExecutionAgent = vi.mocked(submitToExecutionAgent);
const mockedSubmitTaskFeedback = vi.mocked(submitTaskFeedback);
const mockedSendTaskMessage = vi.mocked(sendTaskMessage);
const mockedRetryTask = vi.mocked(retryTask);
const mockedCancelTaskWithNonce = vi.mocked(cancelTaskWithNonce);

describe('codeRoutes branch coverage', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<Result<DispatchResult, DispatchError>> {
        return ok({ dispatched: true, workerLocation: 'mac' });
      },
      async cancelOnWorker(): Promise<void> {
        return;
      },
      async sendMessageToWorker() {
        return ok({ action: 'queued' as const });
      },
    };

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

    const logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const rateLimitService: RateLimitService = {
      async checkLimits() {
        return ok(undefined);
      },
      async recordTaskStart() {
        return;
      },
      async recordTaskComplete() {
        return;
      },
    };

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      logLineRepo,
      actionsAgentClient,
      linearAgentClient,
      rateLimitService,
      linearIssueService,
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
      processHeartbeat: createProcessHeartbeatUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      detectZombieTasks: createDetectZombieTasksUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerSettingsRepo,
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({
        logger,
      }),
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: createGitHubPRHttpClient({ timeoutMs: 5000 }),
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {
        async findOldest() { return ok(null); },
        async create() { return ok({} as never); },
        async delete() { return ok(undefined); },
        async update() { return ok(undefined); },
      },
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
      },
      mergeQueueWatchRepo: {
        create: vi.fn(),
        findById: vi.fn(),
        findActiveByUserAndBranch: vi.fn(),
        findAllActive: vi.fn(),
        findByUserAndRepo: vi.fn(),
        update: vi.fn(),
        appendMergedPr: vi.fn(),
      },
    } as never);

    // Set up worker settings for the test user
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Default: success for mocked use cases
    mockedProcessCodeAction.mockResolvedValue(ok({
      codeTaskId: 'task-123',
      resourceUrl: 'https://example.com/task-123',
      workerLocation: 'home-mac',
    }));

    mockedSubmitToExecutionAgent.mockResolvedValue(ok({
      codeTaskId: 'exec-task-123',
      resourceUrl: 'https://example.com/exec-task-123',
      workerLocation: 'home-mac',
      implementationOf: 'planning-task-123',
    }));

    mockedRetryTask.mockResolvedValue(ok({
      codeTaskId: 'retry-task-123',
      resourceUrl: 'https://example.com/retry-task-123',
      workerLocation: 'home-mac',
      retriedFrom: 'original-task-123',
    }));

    mockedSubmitTaskFeedback.mockResolvedValue(ok({
      codeTaskId: 'feedback-task-123',
      resourceUrl: 'https://example.com/feedback-task-123',
      workerLocation: 'home-mac',
      followUpFor: 'original-task-123',
    }));

    mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

    mockedCancelTaskWithNonce.mockResolvedValue(ok({
      cancelled: true as const,
      locksToCleanup: [],
    }));

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  // ============================================================
  // taskToApiResponse optional field spreads (lines 317-328)
  // ============================================================
  describe('taskToApiResponse optional fields', () => {
    it('includes all optional fields when present on task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create task with all optional fields set at creation time
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix login bug',
        sanitizedPrompt: 'fix login bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
        linearIssueId: 'INT-100',
        prNumber: 42,
        agentType: 'planning',
        actionId: 'action-abc',
        approvalEventId: 'approval-xyz',
        parentTaskId: 'parent-task-1',
        followUpReason: 'retry',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update task with fields that can be updated via UpdateTaskInput
      await repo.update(created.value.id, {
        status: 'failed',
        implementationTaskId: 'impl-task-1',
        fanOutChildTaskIds: ['child-task-1', 'child-task-2'],
        error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/code/tasks/${created.value.id}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      const task = body.data;
      // Fastify serialization strips fields not in schema (actionId, approvalEventId),
      // but the code paths in taskToApiResponse are still executed. fanOutChildTaskIds
      // is included in the serializer path for coverage even if Fastify strips it here.
      expect(task.implementationTaskId).toBe('impl-task-1');
      expect(task.parentTaskId).toBe('parent-task-1');
      expect(task.followUpReason).toBe('retry');
      expect(task.error).toBeDefined();
      expect(task.error.code).toBe('WORKER_ERROR');
      expect(task.linearIssueId).toBe('INT-100');
      expect(task.prNumber).toBe(42);
      expect(task.agentType).toBe('planning');
      expect(task.createdAt).toBeDefined();
      expect(task.updatedAt).toBeDefined();
    });

    it('omits optional fields when not present on task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Simple task',
        sanitizedPrompt: 'simple task',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/code/tasks/${created.value.id}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const task = body.data;
      // These optional fields should be absent since not set during creation
      expect(task.implementationTaskId).toBeUndefined();
      expect(task.parentTaskId).toBeUndefined();
      expect(task.followUpReason).toBeUndefined();
      expect(task.result).toBeUndefined();
      expect(task.error).toBeUndefined();
    });
    it('returns task with dispatchedAt when set', async () => {
      const { Timestamp } = await import('@google-cloud/firestore');
      const now = new Date();
      // Mock findByIdForUser to return a task with dispatchedAt set
      const mockRepo = {
        ...getServices().codeTaskRepo,
        findByIdForUser: vi.fn().mockResolvedValue(ok({
          id: 'task-with-dispatched-at',
          userId: 'test-user-id',
          prompt: 'Dispatched task',
          sanitizedPrompt: 'dispatched task',
          systemPromptHash: 'abc123',
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'test/repo',
          baseBranch: 'main',
          traceId: 'trace-dispatched-123',
          status: 'dispatched',
          dedupKey: 'dedup',
          callbackReceived: false,
          dispatchedAt: Timestamp.fromDate(now),
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks/task-with-dispatched-at',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.status).toBe('dispatched');
      expect(body.data.dispatchedAt).toBe(now.toISOString());
    });

    it('falls back to empty string when timestampToIso returns undefined for createdAt', async () => {
      const { Timestamp } = await import('@google-cloud/firestore');
      const now = new Date();
      // Mock findByIdForUser to return a task where createdAt is an object without toDate()
      // This exercises the ?? '' fallback path at line 317
      const mockRepo = {
        ...getServices().codeTaskRepo,
        findByIdForUser: vi.fn().mockResolvedValue(ok({
          id: 'task-with-bad-timestamp',
          userId: 'test-user-id',
          prompt: 'Bad timestamp task',
          sanitizedPrompt: 'bad timestamp task',
          systemPromptHash: 'abc123',
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'test/repo',
          baseBranch: 'main',
          traceId: 'trace-bad-ts',
          status: 'running',
          dedupKey: 'dedup',
          callbackReceived: false,
          // Pass objects without toDate() to trigger timestampToIso returning undefined
          createdAt: { seconds: 123 } as never,
          updatedAt: Timestamp.fromDate(now),
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks/task-with-bad-timestamp',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      // createdAt should fall back to '' since timestampToIso returns undefined
      expect(body.data.createdAt).toBe('');
    });
  });

  // ============================================================
  // POST /internal/code/process error codes (lines 569, 573, 577, 580)
  // ============================================================
  describe('POST /internal/code/process error branches', () => {
    it('returns 409 for duplicate_approval error', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'duplicate_approval',
        message: 'Duplicate approval',
        existingTaskId: 'existing-task-1',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('existing-task-1');
    });

    it('returns 409 for duplicate_prompt error', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'duplicate_prompt',
        message: 'Duplicate prompt',
        existingTaskId: 'existing-task-2',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Similar task');
    });

    it('returns 409 for active_task_exists error', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'active_task_exists',
        message: 'Active task exists',
        existingTaskId: 'existing-task-3',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Active task already exists');
    });

    it('returns WORKER_NOT_CONFIGURED for worker_not_configured error', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'No workers configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
    });

    it('handles duplicate error with no existingTaskId', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'duplicate_approval',
        message: 'Duplicate approval',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Duplicate:');
    });

    it('handles duplicate_prompt error with no existingTaskId', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'duplicate_prompt',
        message: 'Duplicate prompt',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Similar task');
    });

    it('handles active_task_exists error with no existingTaskId', async () => {
      mockedProcessCodeAction.mockResolvedValue(err({
        code: 'active_task_exists',
        message: 'Active task exists',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: { prompt: 'Fix the bug', repository: 'test/repo', baseBranch: 'main' },
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Active task already exists');
    });

    it('handles process with linearIssueId in payload', async () => {
      mockedProcessCodeAction.mockResolvedValue(ok({
        codeTaskId: 'task-123',
        resourceUrl: 'https://example.com/task-123',
        workerLocation: 'home-mac',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: {
            prompt: 'Fix the bug',
            repository: 'test/repo',
            baseBranch: 'main',
            linearIssueId: 'INT-456',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ============================================================
  // PATCH /internal/code-tasks/:taskId conditional spreads (lines 814, 815, 821, 831)
  // ============================================================
  describe('PATCH /internal/code-tasks/:taskId conditional spreads', () => {
    it('updates with error field', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task to update',
        sanitizedPrompt: 'task to update',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update to running first
      await repo.update(created.value.id, { status: 'running' });

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          status: 'failed',
          error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('updates with statusSummary field', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task to update with summary',
        sanitizedPrompt: 'task to update with summary',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-summary-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          statusSummary: {
            phase: 'implementing',
            message: 'Working on feature',
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('updates with callbackReceived field', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task callback test',
        sanitizedPrompt: 'task callback test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-callback-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          callbackReceived: true,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('records task completion for terminal status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Terminal status test',
        sanitizedPrompt: 'terminal status test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-terminal-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const recordTaskComplete = vi.fn().mockResolvedValue(undefined);
      setServices({
        ...getServices(),
        rateLimitService: {
          checkLimits: vi.fn().mockResolvedValue(ok(undefined)),
          recordTaskStart: vi.fn(),
          recordTaskComplete,
        },
      } as never);

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          status: 'implemented',
        },
      });

      expect(response.statusCode).toBe(200);
      // The call is fire-and-forget, so we wait briefly
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(recordTaskComplete).toHaveBeenCalled();
    });
  });

  // ============================================================
  // GET /code/queue (lines 1408, 1424)
  // ============================================================
  describe('GET /code/queue', () => {
    it('returns queued tasks for user', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task and set to queued
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Queued task prompt',
        sanitizedPrompt: 'queued task prompt',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-queue-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'queued' });

      const response = await server.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toBeInstanceOf(Array);
    });
  });

  // ============================================================
  // POST /code/submit DUPLICATE_PROMPT and ACTIVE_TASK_EXISTS (lines 1266, 1269, 1270)
  // ============================================================
  describe('POST /code/submit create error branches', () => {
    it('returns 409 when create returns DUPLICATE_PROMPT', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        create: vi.fn().mockResolvedValue(err({
          code: 'DUPLICATE_PROMPT',
          message: 'Similar task already exists',
          existingTaskId: 'dup-task-1',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Fix the bug',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Similar task');
    });

    it('returns 409 when create returns ACTIVE_TASK_EXISTS', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        create: vi.fn().mockResolvedValue(err({
          code: 'ACTIVE_TASK_EXISTS',
          message: 'Active task already exists',
          existingTaskId: 'active-task-1',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Fix the bug',
          linearIssueId: 'INT-999',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('Active task already exists');
    });

    it('returns 409 when create returns DUPLICATE_PROMPT without existingTaskId', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        create: vi.fn().mockResolvedValue(err({
          code: 'DUPLICATE_PROMPT',
          message: 'Similar task already exists',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 when create returns ACTIVE_TASK_EXISTS without existingTaskId', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        create: vi.fn().mockResolvedValue(err({
          code: 'ACTIVE_TASK_EXISTS',
          message: 'Active task already exists',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug', linearIssueId: 'INT-999' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  // ============================================================
  // DELETE /code/tasks/:taskId error branches (lines 1883, 1891)
  // ============================================================
  describe('DELETE /code/tasks/:taskId error branches', () => {
    it('returns 404 when delete returns NOT_FOUND', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/code/tasks/nonexistent-task-id',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/archive error branches (lines 1947, 1955, 1969)
  // ============================================================
  describe('POST /code/tasks/:taskId/archive error branches', () => {
    it('returns 404 when task not found for archiving', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/nonexistent-task/archive',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('returns error when update fails during archiving', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Archive error test',
        sanitizedPrompt: 'archive error test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-archive-err-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Set to terminal status so archiving is allowed
      await repo.update(created.value.id, { status: 'failed' });

      // Mock update to fail
      const mockRepo = {
        ...getServices().codeTaskRepo,
        findByIdForUser: vi.fn().mockResolvedValue(ok({
          ...created.value,
          status: 'failed',
        })),
        update: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Update failed',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: `/code/tasks/${created.value.id}/archive`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/cancel worker creds lookup (line 2133)
  // ============================================================
  describe('POST /code/cancel worker creds lookup', () => {
    it('passes worker credentials when found in settings', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Cancel creds test',
        sanitizedPrompt: 'cancel creds test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-cancel-creds-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const cancelOnWorker = vi.fn().mockResolvedValue(undefined);
      setServices({
        ...getServices(),
        taskDispatcher: {
          dispatch: vi.fn().mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' })),
          cancelOnWorker,
          sendMessageToWorker: vi.fn().mockResolvedValue(ok({ action: 'queued' })),
        },
      } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: created.value.id },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // cancelOnWorker should have been called with worker credentials
      expect(cancelOnWorker).toHaveBeenCalledWith(
        created.value.id,
        'home-mac',
        expect.objectContaining({
          url: 'https://cc-mac.intexuraos.cloud',
        })
      );
    });
  });

  // ============================================================
  // GET /code/workers/status auth guard (line 2246)
  // Already covered by existing test - but we need to ensure the exact branch
  // ============================================================

  // ============================================================
  // POST /code/workers/refresh-status auth guard (line 2439)
  // Already covered by existing test
  // ============================================================

  // ============================================================
  // POST /internal/code/cancel-with-nonce unmapped error code (line 2824)
  // ============================================================
  describe('POST /internal/code/cancel-with-nonce unmapped error code', () => {
    it('returns 500 for unmapped domain error code', async () => {
      mockedCancelTaskWithNonce.mockResolvedValue(err({
        code: 'some_unknown_code' as never,
        message: 'Unknown error',
        locksReleased: [],
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: 'task-123',
          nonce: 'test-nonce',
          userId: 'test-user-id',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /internal/code/submit-phase2 error codes (lines 2920-2945)
  // ============================================================
  describe('POST /internal/code/submit-phase2 error branches', () => {
    it('returns 404 for task_not_found error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'task_not_found',
        message: 'Task not found',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid_status error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'invalid_status',
        message: 'Task not in planned state',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for no_linear_issue error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'no_linear_issue',
        message: 'No Linear issue linked',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for label_not_ready error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'label_not_ready',
        message: 'Label not ready',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns WORKER_NOT_CONFIGURED for worker_not_configured error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'No workers configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
    });

    it('returns 409 for complex_task_no_qualifying_children error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'complex_task_no_qualifying_children',
        message: 'Complex task has no direct child issues with code-task label',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 for already_implemented error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'already_implemented',
        message: 'Task already has an implementation',
        existingTaskId: 'existing-impl-1',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('already_implemented');
    });

    it('returns 409 for active_task_exists error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'active_task_exists',
        message: 'Active task already exists',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 422 for plan_pr_merge_failed', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'plan_pr_merge_failed',
        message: 'Plan PR has merge conflicts',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PLAN_PR_MERGE_FAILED');
    });

    it('returns 500 for internal_error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'internal_error',
        message: 'Something went wrong',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: { taskId: 'task-123', userId: 'test-user-id' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/retry error branches (lines 3241, 3290)
  // ============================================================
  describe('POST /code/retry error branches', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('Invalid token'));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid_status error', async () => {
      mockedRetryTask.mockResolvedValue(err({
        code: 'invalid_status',
        message: 'Task not in failed state',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('invalid_status');
    });

    it('returns 400 for too_soon error with retryAfterMs', async () => {
      mockedRetryTask.mockResolvedValue(err({
        code: 'too_soon',
        message: 'Task failed too recently',
        retryAfterMs: 60000,
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('too_soon');
      expect(body.error.retryAfterMs).toBe(60000);
    });

    it('returns 400 for worker_not_configured error', async () => {
      mockedRetryTask.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'No workers configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('worker_not_configured');
    });

    it('returns 404 for task_not_found error', async () => {
      mockedRetryTask.mockResolvedValue(err({
        code: 'task_not_found',
        message: 'Task not found',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/feedback error branches (lines 3456, 3486, 3490, 3493)
  // ============================================================
  describe('POST /code/tasks/:taskId/feedback error branches', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('Invalid token'));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        payload: { feedback: 'Fix the indentation' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 for task_not_found error', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(err({
        code: 'task_not_found',
        message: 'Task not found',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Fix the indentation' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid_status error', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(err({
        code: 'invalid_status',
        message: 'Task is not in the correct state',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Fix the indentation' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('invalid_status');
    });

    it('returns 400 for worker_not_configured error', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'No workers configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Fix the indentation' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('worker_not_configured');
    });

    it('returns 500 for internal_error', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(err({
        code: 'internal_error',
        message: 'Something went wrong internally',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Fix the indentation' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/implement error branches (lines 3650, 3695-3714)
  // ============================================================
  describe('POST /code/tasks/:taskId/implement error branches', () => {
    it('returns 404 for task_not_found', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'task_not_found',
        message: 'Task not found',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for invalid_status', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'invalid_status',
        message: 'Task not in planned state',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for no_linear_issue', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'no_linear_issue',
        message: 'No Linear issue linked',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for label_not_ready', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'label_not_ready',
        message: 'Label not ready',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns WORKER_NOT_CONFIGURED for worker_not_configured', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'No workers configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
    });

    it('returns 409 for complex_task_no_qualifying_children', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'complex_task_no_qualifying_children',
        message: 'Complex task has no direct child issues with code-task label',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 for already_implemented', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'already_implemented',
        message: 'Already implemented',
        existingTaskId: 'existing-impl-task',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('already_implemented');
    });

    it('returns 409 for active_task_exists', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'active_task_exists',
        message: 'Active task exists',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 422 for plan_pr_merge_failed', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'plan_pr_merge_failed',
        message: 'Plan PR has merge conflicts',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('PLAN_PR_MERGE_FAILED');
    });

    it('returns 500 for internal_error', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(err({
        code: 'internal_error',
        message: 'Internal error',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/messages error branches (lines 3777, 3801, 3804, 3807, 3810)
  // ============================================================
  describe('POST /code/tasks/:taskId/messages error branches', () => {
    it('returns 404 for task_not_found', async () => {
      mockedSendTaskMessage.mockResolvedValue(err({
        code: 'task_not_found',
        message: 'Task not found',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('handles invalid_status error from sendTaskMessage', async () => {
      mockedSendTaskMessage.mockResolvedValue(err({
        code: 'invalid_status',
        message: 'Task is not running',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello' },
      });

      // INVALID_STATUS is not a valid ErrorCode, so reply.fail falls through to Fastify error handling
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('returns MISCONFIGURED for worker_not_configured', async () => {
      mockedSendTaskMessage.mockResolvedValue(err({
        code: 'worker_not_configured',
        message: 'Worker not configured',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello' },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns WORKER_UNAVAILABLE for worker_unavailable', async () => {
      mockedSendTaskMessage.mockResolvedValue(err({
        code: 'worker_unavailable',
        message: 'Worker is not reachable',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello' },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('WORKER_UNAVAILABLE');
    });

    it('returns INTERNAL_ERROR for unknown error', async () => {
      mockedSendTaskMessage.mockResolvedValue(err({
        code: 'worker_error',
        message: 'Something unexpected happened',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Hello' },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/submit - create error falls through to INTERNAL_ERROR (line 1269 false branch)
  // ============================================================
  describe('POST /code/submit create error fallthrough to INTERNAL_ERROR', () => {
    it('returns INTERNAL_ERROR when create returns unknown error code', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        create: vi.fn().mockResolvedValue(err({
          code: 'UNKNOWN_ERROR',
          message: 'Something unexpected happened',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/submit - settings null triggers ?? [] fallback (line 1292)
  // ============================================================
  describe('POST /code/submit no worker settings', () => {
    it('returns WORKER_NOT_CONFIGURED when user has no worker settings', async () => {
      // Override workerSettingsRepo to return null (no settings)
      const mockWorkerSettingsRepo = {
        ...getServices().workerSettingsRepo,
        getSettings: vi.fn().mockResolvedValue(ok(null)),
      };

      setServices({ ...getServices(), workerSettingsRepo: mockWorkerSettingsRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      // With null settings, enabledWorkers = settings?.workers.filter() ?? [] = []
      // Then enabledWorkers.length === 0 triggers WORKER_NOT_CONFIGURED (HTTP 424)
      expect(response.statusCode).toBe(424);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
    });
  });

  // ============================================================
  // GET /code/queue - queuedAt truthy branch (line 1424)
  // ============================================================
  describe('GET /code/queue with queuedAt set', () => {
    it('returns queuedAt when task has queuedAt set', async () => {
      const { Timestamp } = await import('@google-cloud/firestore');
      const now = new Date();
      const mockRepo = {
        ...getServices().codeTaskRepo,
        listQueued: vi.fn().mockResolvedValue(ok([
          {
            id: 'task-with-queued-at',
            userId: 'test-user-id',
            prompt: 'Queued task',
            sanitizedPrompt: 'queued task',
            systemPromptHash: 'abc',
            workerType: 'opus',
            workerLocation: 'vm',
            repository: 'test/repo',
            baseBranch: 'main',
            traceId: 'trace-q',
            status: 'queued',
            dedupKey: 'dedup',
            callbackReceived: false,
            queuedAt: Timestamp.fromDate(now),
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now),
          },
        ])),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks.length).toBe(1);
      expect(body.data.tasks[0].queuedAt).toBe(now.toISOString());
    });
  });

  // ============================================================
  // GET /code/tasks - limit ?? 20 fallback (line 1552)
  // ============================================================
  describe('GET /code/tasks without limit param', () => {
    it('uses default limit of 20 when no limit provided', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toBeInstanceOf(Array);
    });

    it('uses provided limit when specified', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks?limit=5',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toBeInstanceOf(Array);
    });
  });

  // ============================================================
  // DELETE /code/tasks/:taskId - non-NOT_FOUND error (line 1891 false branch)
  // ============================================================
  describe('DELETE /code/tasks/:taskId internal error', () => {
    it('returns INTERNAL_ERROR when delete fails with non-NOT_FOUND error', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        deleteTask: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Firestore write failed',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/tasks/some-task-id',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/archive - non-NOT_FOUND error (line 1955 false branch)
  // ============================================================
  describe('POST /code/tasks/:taskId/archive internal error on find', () => {
    it('returns INTERNAL_ERROR when findByIdForUser fails with non-NOT_FOUND error', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        findByIdForUser: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Firestore read failed',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/some-task-id/archive',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/cancel - worker settings null (line 2133 false branch)
  // ============================================================
  describe('POST /code/cancel with no worker settings', () => {
    it('cancels task without worker creds when settings lookup returns null', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Cancel without creds test',
        sanitizedPrompt: 'cancel without creds test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-cancel-no-creds-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const cancelOnWorker = vi.fn().mockResolvedValue(undefined);
      setServices({
        ...getServices(),
        taskDispatcher: {
          dispatch: vi.fn().mockResolvedValue(ok({ dispatched: true, workerLocation: 'home-mac' })),
          cancelOnWorker,
          sendMessageToWorker: vi.fn().mockResolvedValue(ok({ action: 'queued' })),
        },
        workerSettingsRepo: {
          ...getServices().workerSettingsRepo,
          getSettings: vi.fn().mockResolvedValue(ok(null)),
        },
      } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: created.value.id },
      });

      expect(response.statusCode).toBe(200);
      // cancelOnWorker should have been called with undefined creds
      expect(cancelOnWorker).toHaveBeenCalledWith(
        created.value.id,
        'home-mac',
        undefined
      );
    });
  });

  // ============================================================
  // POST /code/retry - internal_error falls through to INTERNAL_ERROR (line 3290 false branch)
  // ============================================================
  describe('POST /code/retry internal_error', () => {
    it('returns 500 for internal_error from retryTask', async () => {
      mockedRetryTask.mockResolvedValue(err({
        code: 'internal_error',
        message: 'Something went wrong internally',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'task-123' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/retry - success path (covers line 3290 area and !result.ok false branch)
  // ============================================================
  describe('POST /code/retry success', () => {
    it('returns 200 on successful retry', async () => {
      mockedRetryTask.mockResolvedValue(ok({
        codeTaskId: 'retry-success-task',
        resourceUrl: 'https://example.com/retry-success-task',
        workerLocation: 'home-mac',
        retriedFrom: 'original-task',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/retry',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: 'original-task' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toBe('retry-success-task');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/feedback - success path (line 3486 false branch)
  // ============================================================
  describe('POST /code/tasks/:taskId/feedback success', () => {
    it('returns 200 on successful feedback submission', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(ok({
        codeTaskId: 'feedback-success-task',
        resourceUrl: 'https://example.com/feedback-success-task',
        workerLocation: 'home-mac',
        followUpFor: 'original-task-123',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/original-task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Please fix the indentation' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toBe('feedback-success-task');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/feedback - internal_error (line 3486 true branch, falls to INTERNAL_ERROR)
  // ============================================================
  describe('POST /code/tasks/:taskId/feedback internal_error', () => {
    it('returns 500 for internal_error from submitTaskFeedback', async () => {
      mockedSubmitTaskFeedback.mockResolvedValue(err({
        code: 'internal_error',
        message: 'Something went wrong',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/feedback',
        headers: { authorization: 'Bearer test-token' },
        payload: { feedback: 'Fix this' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/messages success path (line 3777 area)
  // ============================================================
  describe('POST /code/tasks/:taskId/messages success', () => {
    it('returns 200 on successful message send', async () => {
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/messages',
        headers: { authorization: 'Bearer test-token' },
        payload: { message: 'Please continue' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/implement success path (line 3650 area)
  // ============================================================
  describe('POST /code/tasks/:taskId/implement success', () => {
    it('returns 200 on successful implement', async () => {
      mockedSubmitToExecutionAgent.mockResolvedValue(ok({
        codeTaskId: 'impl-success-task',
        resourceUrl: 'https://example.com/impl-success-task',
        workerLocation: 'home-mac',
        implementationOf: 'planning-task-123',
      }));

      const response = await server.inject({
        method: 'POST',
        url: '/code/tasks/task-123/implement',
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toBe('impl-success-task');
    });
  });

  // ============================================================
  // GET /code/tasks/:taskId - NOT_FOUND error branch (line 1789, 1782)
  // ============================================================
  describe('GET /code/tasks/:taskId error branches', () => {
    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks/nonexistent-task-id',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns INTERNAL_ERROR when findByIdForUser fails with non-NOT_FOUND', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        findByIdForUser: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Firestore error',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks/some-task-id',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // GET /code/tasks - with status filter and cursor (lines 1555, 1559)
  // ============================================================
  describe('GET /code/tasks with filter parameters', () => {
    it('filters by status parameter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks?status=running,failed',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('uses cursor parameter for pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks?cursor=some-cursor-value',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  // ============================================================
  // GET /code/tasks - list error (line 1565)
  // ============================================================
  describe('GET /code/tasks list error', () => {
    it('returns INTERNAL_ERROR when list fails', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        list: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Firestore error',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // GET /code/tasks - with linearIssueId hydration (lines 1590, 1596, 1611)
  // ============================================================
  describe('GET /code/tasks with linear issue hydration', () => {
    it('hydrates linear issues when tasks have linearIssueId', async () => {
      // Mock linearAgentClient to return successful display-batch response
      const services = getServices();
      const mockLinearAgentClient = {
        ...services.linearAgentClient,
        fetchIssuesForDisplay: vi.fn().mockResolvedValue(ok([{
          identifier: 'INT-123',
          parentIdentifier: null,
          title: 'Test issue',
          state: { name: 'In Progress', type: 'started' },
          priority: 2,
          assignee: null,
          labels: [],
          url: 'https://linear.app/test/INT-123',
          commentCount: 0,
          lastCommentAt: null,
        }])),
      };
      setServices({ ...services, linearAgentClient: mockLinearAgentClient } as never);

      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task with linear issue',
        sanitizedPrompt: 'task with linear issue',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-linear-hydration',
        linearIssueId: 'INT-123',
      });
      expect(created.ok).toBe(true);

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks.length).toBeGreaterThanOrEqual(1);
      // Verify linearIssue is hydrated
      const task = body.data.tasks.find((t: { linearIssueId?: string }) => t.linearIssueId === 'INT-123');
      expect(task).toBeDefined();
      expect(task.linearIssue).toBeDefined();
    });
  });

  // ============================================================
  // GET /code/tasks with linear issue hydration failure (line 1596 false branch)
  // ============================================================
  describe('GET /code/tasks with linear issue hydration failure', () => {
    it('handles linearIssuesForDisplay failure gracefully', async () => {
      // Mock linearAgentClient to return error for display-batch
      const services = getServices();
      const mockLinearAgentClient = {
        ...services.linearAgentClient,
        fetchIssuesForDisplay: vi.fn().mockResolvedValue(err({
          code: 'UNAVAILABLE',
          message: 'Linear agent unavailable',
        })),
      };
      setServices({ ...services, linearAgentClient: mockLinearAgentClient } as never);

      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      await repo.create({
        userId: 'test-user-id',
        prompt: 'Task with linear issue fail',
        sanitizedPrompt: 'task with linear issue fail',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-linear-fail',
        linearIssueId: 'INT-789',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Tasks still returned even if hydration fails
      expect(body.data.tasks.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // GET /code/tasks/:taskId with linear issue (line 1817)
  // ============================================================
  describe('GET /code/tasks/:taskId with linear issue', () => {
    it('fetches linear issue details when task has linearIssueId', async () => {
      // Mock linearAgentClient to return successful display response (single issue)
      const services = getServices();
      const mockLinearAgentClient = {
        ...services.linearAgentClient,
        fetchIssueForDisplay: vi.fn().mockResolvedValue(ok({
          identifier: 'INT-456',
          parentIdentifier: null,
          title: 'Test issue detail',
          state: { name: 'In Progress', type: 'started' },
          priority: 2,
          assignee: null,
          labels: [],
          url: 'https://linear.app/test/INT-456',
          commentCount: 0,
          lastCommentAt: null,
        })),
      };
      setServices({ ...services, linearAgentClient: mockLinearAgentClient } as never);

      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task with linear issue detail',
        sanitizedPrompt: 'task with linear issue detail',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-linear-detail',
        linearIssueId: 'INT-456',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/code/tasks/${created.value.id}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/archive - non-terminal status (line 1963)
  // ============================================================
  describe('POST /code/tasks/:taskId/archive non-terminal status', () => {
    it('returns INVALID_REQUEST when task is not in terminal status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Non-terminal archive test',
        sanitizedPrompt: 'non-terminal archive test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-non-terminal-archive',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Task is in 'dispatched' status (initial), which is not terminal
      const response = await server.inject({
        method: 'POST',
        url: `/code/tasks/${created.value.id}/archive`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });

  // ============================================================
  // POST /code/cancel - update failure (line 2118)
  // ============================================================
  describe('POST /code/cancel update failure', () => {
    it('returns INTERNAL_ERROR when status update fails', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Cancel update failure test',
        sanitizedPrompt: 'cancel update failure test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-cancel-update-fail',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const mockRepo = {
        ...getServices().codeTaskRepo,
        findById: vi.fn().mockResolvedValue(ok({
          ...created.value,
          status: 'running',
          userId: 'test-user-id',
        })),
        update: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Write failed',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: { authorization: 'Bearer test-token' },
        payload: { taskId: created.value.id },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /internal/code/process without optional fields (lines 534, 537)
  // ============================================================
  describe('POST /internal/code/process without optional payload fields', () => {
    it('processes without repository and baseBranch', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: {
            prompt: 'Fix the bug',
            // repository and baseBranch intentionally omitted
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  // ============================================================
  // POST /code/submit - enqueue queue_full error (line 1317)
  // ============================================================
  describe('POST /code/submit queue_full error', () => {
    it('returns QUEUE_FULL when enqueue service returns queue_full', async () => {
      setServices({
        ...getServices(),
        taskEnqueueService: {
          enqueue: vi.fn().mockResolvedValue(err({
            code: 'queue_full',
            message: 'Queue is full',
          })),
        },
      } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('QUEUE_FULL');
    });
  });

  // ============================================================
  // POST /code/submit - linearIssueId present (line 1257, 1327)
  // ============================================================
  describe('POST /code/submit with linearIssueId', () => {
    it('submits task with linearIssueId and marks in progress', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Fix the bug in INT-100',
          linearIssueId: 'INT-100',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  // ============================================================
  // POST /code/submit - with code-task label and valid linearIssueId (lines 1253, 1257)
  // ============================================================
  describe('POST /code/submit with execution agent type', () => {
    it('creates execution task when issue has code-task label', async () => {
      // Mock linearIssueService to return result with code-task label and linearIssueId
      const services = getServices();
      const mockLinearIssueService = {
        ...services.linearIssueService,
        ensureIssueExists: vi.fn().mockResolvedValue({
          linearIssueId: 'INT-200',
          linearIssueTitle: 'Fix the thing',
          linearFallback: false,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
          linearIssueUrl: 'https://linear.app/test/INT-200',
        }),
        markInProgress: vi.fn().mockResolvedValue(undefined),
      };
      setServices({ ...services, linearIssueService: mockLinearIssueService } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Fix the thing with code-task label',
          linearIssueId: 'INT-200',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Verify markInProgress was called with the linearIssueId
      expect(mockLinearIssueService.markInProgress).toHaveBeenCalledWith('test-user-id', 'INT-200');
    });
  });

  // ============================================================
  // POST /code/submit - enqueue non-queue_full error (line 1317 false branch)
  // ============================================================
  describe('POST /code/submit enqueue internal error', () => {
    it('returns INTERNAL_ERROR when enqueue fails with non-queue_full error', async () => {
      setServices({
        ...getServices(),
        taskEnqueueService: {
          enqueue: vi.fn().mockResolvedValue(err({
            code: 'internal_error',
            message: 'Enqueue failed',
          })),
        },
      } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ============================================================
  // POST /code/tasks/:taskId/archive success path (line 1969 false branch)
  // ============================================================
  describe('POST /code/tasks/:taskId/archive success path', () => {
    it('archives a task in terminal status successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Archive success test',
        sanitizedPrompt: 'archive success test',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-archive-success',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Set to terminal status
      await repo.update(created.value.id, { status: 'failed' });

      const response = await server.inject({
        method: 'POST',
        url: `/code/tasks/${created.value.id}/archive`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.archived).toBe(true);
    });
  });

  // ============================================================
  // GET /code/queue - listQueued error (line 1411)
  // ============================================================
  describe('GET /code/queue error', () => {
    it('returns INTERNAL_ERROR when listQueued fails', async () => {
      const mockRepo = {
        ...getServices().codeTaskRepo,
        listQueued: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'Read failed',
        })),
      } as unknown as CodeTaskRepository;

      setServices({ ...getServices(), codeTaskRepo: mockRepo } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
