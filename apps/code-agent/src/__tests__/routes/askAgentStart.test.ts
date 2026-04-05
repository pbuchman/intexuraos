/**
 * Tests for POST /code/ask-agent/start endpoint
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
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';

describe('POST /code/ask-agent/start', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let taskEnqueueService: TaskEnqueueService;
  let rateLimitService: RateLimitService;

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
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orchestrator-secret';

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

    taskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })),
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

    rateLimitService = {
      checkLimits: vi.fn().mockResolvedValue(ok(undefined)),
      recordTaskStart: vi.fn().mockResolvedValue(undefined),
      recordTaskComplete: vi.fn().mockResolvedValue(undefined),
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
      taskEnqueueService,
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

    // Set up worker settings for the test user
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    app = await buildServer();
  });

  afterEach(async () => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
    await app.close();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        payload: {
          prompt: 'What is the architecture?',
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

    it('returns 401 with invalid token', async () => {
      mockedJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          prompt: 'What is the architecture?',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('successful task submission', () => {
    it('creates task with valid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'What is the architecture of this codebase?',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('submitted');
      expect(body.data.codeTaskId).toBeDefined();

      // Verify enqueue was called
      expect(taskEnqueueService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: body.data.codeTaskId,
          userId: 'test-user-id',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('returns rate limited error when rate limit exceeded', async () => {
      vi.mocked(rateLimitService.checkLimits).mockResolvedValueOnce(
        err({ code: 'concurrent_limit', message: 'Maximum 2 concurrent tasks allowed' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Ask something',
        },
      });

      // Rate limit errors map to RATE_LIMITED
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
    });

    it('returns 400 when prompt is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when prompt is empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 503 when service_unavailable from rate limiter', async () => {
      vi.mocked(rateLimitService.checkLimits).mockResolvedValueOnce(
        err({ code: 'service_unavailable', message: 'Rate limit service unavailable' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Ask something',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns WORKER_NOT_CONFIGURED when no workers are enabled', async () => {
      // Use a different user that has no workers configured
      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: 'user-with-no-workers', email: 'noworkers@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Ask something',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
    });

    it('returns CONFLICT when duplicate prompt is detected', async () => {
      // Submit the same prompt twice to trigger dedup
      await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Exact same prompt for dedup test',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Exact same prompt for dedup test',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns QUEUE_FULL when task queue is full', async () => {
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'queue_full', message: 'Task queue is full' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Ask something about queue',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('QUEUE_FULL');
    });

    it('returns INTERNAL_ERROR when enqueue fails with unexpected error', async () => {
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'internal_error', message: 'Firestore write failed unexpectedly' }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/ask-agent/start',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Ask something triggering internal error',
        },
      });

      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
