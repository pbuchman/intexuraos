/**
 * Tests for GET /code/queue endpoint (INT-949)
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
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';

describe('GET /code/queue', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

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

    const taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe });
    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

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

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    const rateLimitService = {
      async checkLimits(): Promise<ReturnType<typeof ok>> { return ok(undefined); },
      async recordTaskStart(): Promise<void> { return; },
      async recordTaskComplete(): Promise<void> { return; },
    };

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher,
      workerSettingsRepo,
      whatsappNotifier,
      logChunkRepo,
      logLineRepo,
      actionsAgentClient,
      linearAgentClient,
      rateLimitService,
      linearIssueService,
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({ actionsAgentClient, logger }),
      processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
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
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })),
      },
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
        method: 'GET',
        url: '/code/queue',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toEqual(expect.objectContaining({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      }));
    });
  });

  describe('empty queue', () => {
    it('returns empty tasks array when no queued tasks exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toEqual([]);
      expect(body.data.totalQueued).toBe(0);
      expect(body.data.maxQueueSize).toBeGreaterThan(0);
    });
  });

  describe('with queued tasks', () => {
    it('returns queued tasks ordered by creation time', async () => {
      // Create queued tasks owned by the authenticated user (JWT sub: 'test-user-id')
      const result1 = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'First queued task',
        sanitizedPrompt: 'First queued task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'pending',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_q1',
        linearIssueId: 'INT-100',
        agentType: 'planning',
      });

      if (!result1.ok) {
        throw new Error(`Failed to create task 1: ${result1.error.message}`);
      }

      const result2 = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Second queued task',
        sanitizedPrompt: 'Second queued task',
        systemPromptHash: 'default',
        workerType: 'opus',
        workerLocation: 'pending',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_q2',
        agentType: 'execution',
      });

      if (!result2.ok) {
        throw new Error(`Failed to create task 2: ${result2.error.message}`);
      }

      // Create a non-queued task (should not appear — different status)
      const result3 = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Running task',
        sanitizedPrompt: 'Running task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_r1',
        initialStatus: 'dispatched',
      });

      if (!result3.ok) {
        throw new Error(`Failed to create task 3: ${result3.error.message}`);
      }

      // Create a queued task owned by a different user (should not appear — userId scoping)
      const result4 = await codeTaskRepo.create({
        userId: 'other-user-id',
        prompt: 'Other user task',
        sanitizedPrompt: 'Other user task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'pending',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_q3',
      });

      if (!result4.ok) {
        throw new Error(`Failed to create task 4: ${result4.error.message}`);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalQueued).toBe(2);
      expect(body.data.tasks).toHaveLength(2);

      // First task
      const task1 = body.data.tasks[0];
      expect(task1.id).toBe(result1.value.id); // @allow-result-access -- narrowed by !result1.ok throw above
      expect(task1.prompt).toBe('First queued task');
      expect(task1.linearIssueId).toBe('INT-100');
      expect(task1.workerType).toBe('auto');
      expect(task1.agentType).toBe('planning');
      expect(task1.position).toBe(1);
      expect(task1.createdAt).toBeDefined();
      expect(task1.queuedAt).toBeDefined();

      // Second task
      const task2 = body.data.tasks[1];
      expect(task2.id).toBe(result2.value.id); // @allow-result-access -- narrowed by !result2.ok throw above
      expect(task2.prompt).toBe('Second queued task');
      expect(task2.workerType).toBe('opus');
      expect(task2.agentType).toBe('execution');
      expect(task2.position).toBe(2);
    });

    it('truncates prompt to 200 characters', async () => {
      const longPrompt = 'A'.repeat(500);
      const result = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: longPrompt,
        sanitizedPrompt: longPrompt,
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'pending',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_long',
      });

      if (!result.ok) {
        throw new Error(`Failed to create task: ${result.error.message}`);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.tasks[0].prompt).toHaveLength(200);
    });
  });

  describe('error handling', () => {
    it('returns 500 when listQueued fails', async () => {
      vi.spyOn(codeTaskRepo, 'listQueued').mockResolvedValueOnce({
        ok: false,
        error: { code: 'FIRESTORE_ERROR', message: 'DB unavailable' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/code/queue',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
