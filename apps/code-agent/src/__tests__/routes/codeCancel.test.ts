/**
 * Tests for POST /code/cancel endpoint
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
import { getServices, resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';

describe('POST /code/cancel', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let cancelOnWorkerSpy: ReturnType<typeof vi.fn> | null;

  beforeEach(async () => {
    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskDispatcher = createTaskDispatcherService({
      logger,
      workerHealthProbe: mockWorkerHealthProbe,
    });

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
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

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    // Spy on cancelOnWorker to verify it's called
    cancelOnWorkerSpy = vi.spyOn(taskDispatcher, 'cancelOnWorker') as ReturnType<typeof vi.fn>;
    cancelOnWorkerSpy = vi.spyOn(taskDispatcher, 'cancelOnWorker') as ReturnType<typeof vi.fn>;
    cancelOnWorkerSpy.mockResolvedValue(undefined);

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
      archiveStaleGroups: {} as never,
      autoArchiveMergedTasks: {} as never,
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
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
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: {} as never,
      taskEnqueueService: {} as never,
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
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      linearAgentClient: LinearAgentClient;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      autoArchiveMergedTasks: import('../../domain/usecases/autoArchiveMergedTasks.js').AutoArchiveMergedTasksUseCase;
      workerSettingsRepo: WorkerSettingsRepository;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    // Set up worker settings for the test user so cancelOnWorker receives credentials
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'cloud-vm',
      url: 'https://cc-vm.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        payload: {
          taskId: 'task-123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
    });

    it('returns 401 with invalid X-Internal-Auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          'x-internal-auth': 'invalid-token',
        },
        payload: {
          taskId: 'task-123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('task not found', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId: 'non-existent-task',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Task not found');
    });
  });

  describe('ownership verification', () => {
    it('returns 403 for other user task', async () => {
      // Create a task for a different user
      const createResult = await codeTaskRepo.create({
        userId: 'other-user',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      // Try to cancel as unknown-user
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('Not authorized to cancel this task');
    });
  });

  describe('task status validation', () => {
    it('returns 409 for already completed task', async () => {
      // Create and complete a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'implemented' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toBe('Task is not in a cancellable state');
    });

    it('returns 409 for already cancelled task', async () => {
      // Create and cancel a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'cancelled' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toBe('Task is not in a cancellable state');
    });

    it('returns 409 for failed task', async () => {
      // Create and fail a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'failed' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toBe('Task is not in a cancellable state');
    });
  });

  describe('successful cancellation', () => {
    it('successfully cancels a dispatched task', async () => {
      // Create a dispatched task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');

      // Verify worker was notified
      expect(cancelOnWorkerSpy).toHaveBeenCalledTimes(1);
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'home-mac', expect.objectContaining({
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
      }));

      // Verify task status in Firestore
      const getResult = await codeTaskRepo.findById(taskId);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });

    it('successfully cancels a running task', async () => {
      // Create a running task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'cloud-vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');

      // Verify worker was notified
      expect(cancelOnWorkerSpy).toHaveBeenCalledTimes(1);
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'cloud-vm', expect.objectContaining({
        url: 'https://cc-vm.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
      }));
    });

    it('calls worker to stop task', async () => {
      // Create a running task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify cancelOnWorker was called with correct parameters
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'home-mac', expect.objectContaining({
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
      }));
    });

    it('handles Firestore update failure gracefully', async () => {
      // Create a running task with the same userId as the JWT mock returns
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'cloud-vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      // Mock the codeTaskRepo.update to return an error
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce({
        ok: false,
        error: { code: 'FIRESTORE_ERROR', message: 'Firestore update failed' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to cancel task');

      updateSpy.mockRestore();
    });

    it('continues cancellation even when worker notification fails', async () => {
      // Create a running task with the same userId as the JWT mock returns
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'cloud-vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      // Mock cancelOnWorker to throw an error
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      cancelOnWorkerSpy.mockImplementationOnce(() => {
        throw new Error('Worker notification failed');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      // Should still succeed - the task is cancelled in Firestore
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');

      // Verify task was still marked cancelled in Firestore
      const getResult = await codeTaskRepo.findById(taskId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.status).toBe('cancelled');
      }
    });

    it('calls recordTaskComplete when task is cancelled successfully', async () => {
      // Create a running task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const { getServices } = await import('../../services.js');
      const services = getServices();
      const recordCompleteSpy = vi.spyOn(services.rateLimitService, 'recordTaskComplete');

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(recordCompleteSpy).toHaveBeenCalledWith('test-user-id');
    });

    it('continues cancellation even when recordTaskComplete fails', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'home-mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const { getServices } = await import('../../services.js');
      const services = getServices();
      vi.spyOn(services.rateLimitService, 'recordTaskComplete').mockRejectedValueOnce(
        new Error('Rate limit service unavailable')
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');

      const getResult = await codeTaskRepo.findById(taskId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.status).toBe('cancelled');
      }
    });
  });
});
