/**
 * Tests for POST /code/submit endpoint
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
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createAutoArchiveMergedTasksUseCase } from '../../domain/usecases/autoArchiveMergedTasks.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';

describe('POST /code/submit', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let taskEnqueueService: TaskEnqueueService;
  let logChunkRepo: LogChunkRepository;

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

    taskEnqueueService = {
      enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })),
    };

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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      autoArchiveMergedTasks: createAutoArchiveMergedTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
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
      resolveToolCallingClient: (() => { throw new Error('unused'); }) as never,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: {} as never,
      taskEnqueueService,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
      },
      prTriagePublisher: {} as never,
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
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
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
      resolveToolCallingClient: (userId: string) => Promise<import('@intexuraos/common-core').Result<import('@intexuraos/llm-contract').ToolCallingClient, import('../../domain/usecases/githubAgent.js').GitHubAgentError>>;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
      prTriagePublisher: import('@intexuraos/pr-triage-pubsub-client').PRTriagePublisher;
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

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        payload: {
          prompt: 'Fix the bug',
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
      // Make jwtVerify reject to simulate invalid token
      mockedJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          prompt: 'Fix the bug',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('successful task submission', () => {
    it('creates task with valid request and defaults workerType to auto', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
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
        })
      );
    });

    it('sets agentType to execution when issue has code-task label', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Execution ready feature',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Build execution feature' },
      });

      expect(response.statusCode).toBe(200);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          linearIssueId: 'INT-999',
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueTitle: expect.anything(),
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueLabels: expect.anything(),
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearFallback: expect.anything(),
        })
      );
    });

    it('uses provided workerType when specified', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-124',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          workerType: 'opus',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the worker type was passed through to task creation
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workerType: 'opus',
        })
      );
    });

    it('includes linearIssueId when provided', async () => {
      // Mock linearIssueService.ensureIssueExists to return the provided issue ID
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-305',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          linearIssueId: 'INT-305',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify markInProgress was called with correct userId
      expect(linearService.markInProgress).toHaveBeenCalledWith('test-user-id', 'INT-305');
    });
  });

  describe('taskMode parameter', () => {
    it('uses explicit taskMode=execution to set agentType', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-200',
        linearIssueTitle: 'Implement feature task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Implement feature', taskMode: 'execution' },
      });

      expect(response.statusCode).toBe(200);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
        })
      );
    });

    it('uses explicit taskMode=planning even when issue has code-task label', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Plan feature task',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Plan feature', taskMode: 'planning', linearIssueId: 'INT-999' },
      });

      expect(response.statusCode).toBe(200);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'planning',
        })
      );
    });

    it('falls back to label-based inference when taskMode is omitted', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-888',
        linearIssueTitle: 'Do something task',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Do something unique' },
      });

      expect(response.statusCode).toBe(200);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
        })
      );
    });
  });

  describe('prompt deduplication', () => {
    it('returns 409 for duplicate prompt within 5 minutes', async () => {
      const prompt = 'Fix the login bug';

      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: prompt,
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      // Submit first task
      const response1 = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt,
        },
      });

      expect(response1.statusCode).toBe(200);

      // Try to submit duplicate immediately
      const response2 = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt,
        },
      });

      expect(response2.statusCode).toBe(409);
      const body = JSON.parse(response2.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 when active task exists for Linear issue', async () => {
      const linearIssueId = 'INT-305';

      // Mock linearIssueService.ensureIssueExists
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId,
        linearIssueTitle: 'First task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      // Create first task with this Linear issue via direct repository call
      await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'First task',
        sanitizedPrompt: 'First task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_1',
        linearIssueId,
      });

      // Try to create second task with same Linear issue (should fail)
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Second task',
          linearIssueId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('error handling', () => {
    it('returns 503 when enqueue returns queue_full error', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });

      // Mock enqueue to return queue_full error
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'queue_full', message: 'Queue is full (11/10). Please try again later.' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('QUEUE_FULL');
    });

    it('returns 500 when enqueue returns internal_error', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });

      // Mock enqueue to return internal error
      vi.mocked(taskEnqueueService.enqueue).mockResolvedValueOnce(
        err({ code: 'internal_error', message: 'Firestore connection failed' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Fix the bug' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

  });

  describe('input validation', () => {
    it('rejects requests without prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          // Missing prompt
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts valid worker types', async () => {
      const workerTypes = ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen', 'kimi', 'codex', 'codex-xhigh', 'openrouter-free'] as const;

      const linearService = getServices().linearIssueService;
      // Use fallback mode (no linearIssueId) to avoid ACTIVE_TASK_EXISTS conflicts across iterations
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: true,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      for (const workerType of workerTypes) {
        const response = await app.inject({
          method: 'POST',
          url: '/code/submit',
          headers: {
            authorization: 'Bearer test-token',
          },
          payload: {
            prompt: `Fix the bug with ${workerType}`,
            workerType,
          },
        });

        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe('prompt sanitization', () => {
    it('trims and collapses spaces in prompt', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: '  Fix    the   bug  ',  // Extra spaces
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the prompt was sanitized in task creation
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sanitizedPrompt: 'Fix the bug',  // Sanitized
        })
      );
    });
  });

  describe('scheduled dispatch', () => {
    it('persists dispatchSchedule when execution mode includes valid future scheduledDispatch (INT-1468)', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-700',
        linearIssueTitle: 'Scheduled task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const notBeforeAt = new Date(Date.now() + 60 * 60 * 1000); // 1h in the future
      const notBeforeAtIso = notBeforeAt.toISOString();

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Run this later',
          taskMode: 'execution',
          scheduledDispatch: {
            localDateTime: '2026-04-24T22:00',
            timezone: 'Europe/Warsaw',
            notBeforeAt: notBeforeAtIso,
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      const taskId = body.data.codeTaskId as string;

      // Verify round-trip: load task back and inspect dispatchSchedule
      const taskResult = await codeTaskRepo.findById(taskId);
      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;
      const task = taskResult.value;
      expect(task.dispatchSchedule).toBeDefined();
      expect(task.dispatchSchedule?.notBeforeAt.toMillis()).toBe(notBeforeAt.getTime());
      expect(task.dispatchSchedule?.source).toBe('user_scheduled');
      expect(task.dispatchSchedule?.derivedBy).toBe('user_input');
      expect(task.dispatchSchedule?.timezone).toBe('Europe/Warsaw');
      expect(task.dispatchSchedule?.localDateTime).toBe('2026-04-24T22:00');
    });

    it('rejects scheduledDispatch when taskMode is planning (400 INVALID_REQUEST)', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-701',
        linearIssueTitle: 'Planning task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const notBeforeAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Plan later',
          taskMode: 'planning',
          scheduledDispatch: {
            localDateTime: '2026-04-24T22:00',
            timezone: 'UTC',
            notBeforeAt: notBeforeAtIso,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toMatch(/execution/i);
    });

    it('rejects scheduledDispatch with past notBeforeAt (400 INVALID_REQUEST)', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-702',
        linearIssueTitle: 'Past task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Run in the past',
          taskMode: 'execution',
          scheduledDispatch: {
            localDateTime: '2020-01-01T00:00',
            timezone: 'UTC',
            notBeforeAt: pastIso,
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toMatch(/future/i);
    });

    it('rejects scheduledDispatch with invalid ISO notBeforeAt (400 INVALID_REQUEST)', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-703',
        linearIssueTitle: 'Invalid task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Run with bad iso',
          taskMode: 'execution',
          scheduledDispatch: {
            localDateTime: '2026-04-24T22:00',
            timezone: 'UTC',
            notBeforeAt: 'not-a-valid-iso',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('omits dispatchSchedule on execution submit when scheduledDispatch is not provided', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-704',
        linearIssueTitle: 'No schedule task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Run now',
          taskMode: 'execution',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const taskId = body.data.codeTaskId as string;

      const taskResult = await codeTaskRepo.findById(taskId);
      expect(taskResult.ok).toBe(true);
      if (!taskResult.ok) return;
      expect(taskResult.value.dispatchSchedule).toBeUndefined();
    });
  });

  describe('custom timeout (INT-1585)', () => {
    const stubLinearIssue = (issueId: string, title: string): void => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: issueId,
        linearIssueTitle: title,
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
    };

    it('persists timeoutHours when sent in /code/submit body', async () => {
      stubLinearIssue('INT-800', 'Timeout custom task');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Long-running task',
          timeoutHours: 8,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const taskId = body.data.codeTaskId as string;
      const stored = await codeTaskRepo.findById(taskId);
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;
      expect(stored.value.timeoutHours).toBe(8);
    });

    it('rejects timeoutHours below MIN_TIMEOUT_HOURS', async () => {
      stubLinearIssue('INT-801', 'Bad timeout low');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Bad lower bound',
          timeoutHours: 0,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects timeoutHours above MAX_TIMEOUT_HOURS', async () => {
      stubLinearIssue('INT-802', 'Bad timeout high');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Bad upper bound',
          timeoutHours: 13,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects non-integer timeoutHours via Fastify Ajv integer validation', async () => {
      // The route declares `type: integer` in the JSON-schema body; Ajv
      // therefore rejects floats before the handler runs. There is no
      // additional runtime guard — Ajv coverage is sufficient (INT-1585).
      stubLinearIssue('INT-803', 'Float timeout');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'Float bound',
          timeoutHours: 5.5,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('omitting timeoutHours produces a task without it (backward compat)', async () => {
      stubLinearIssue('INT-804', 'No timeout task');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: 'No override',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const taskId = body.data.codeTaskId as string;
      const stored = await codeTaskRepo.findById(taskId);
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;
      expect(stored.value.timeoutHours).toBeUndefined();
    });
  });
});
