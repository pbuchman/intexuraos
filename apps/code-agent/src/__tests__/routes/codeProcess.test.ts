/**
 * Tests for POST /internal/code/process endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

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

describe('POST /internal/code/process', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let _logChunkRepo: LogChunkRepository;

  beforeEach(async () => {
    // Mock HTTP endpoints to avoid hanging DNS lookups in CI
    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

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

    _logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
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

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo: _logChunkRepo,
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
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('user-123', {
      name: 'home-mac',
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    app = await buildServer();
  });

  afterEach(() => {
    nock.cleanAll();
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  it('returns 401 without X-Internal-Auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      payload: {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the bug',
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    });
  });

  it('creates task and returns 200 with resourceUrl for valid request', async () => {
    // taskEnqueueService.enqueue is already mocked via setServices

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the bug',
          workerType: 'auto',
          repository: 'test/repo',
          baseBranch: 'main',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean; data: { status: string; codeTaskId: string; resourceUrl: string } };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('submitted');
    expect(json.data.codeTaskId).toBeDefined();
    expect(json.data.resourceUrl).toMatch(/^\/#\/code-tasks\/[a-zA-Z0-9_-]+$/);
  });

  it('returns 409 for duplicate approvalEventId', async () => {
    // Mock dispatch to succeed for the first request
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
      ok: true,
      value: { dispatched: true, workerLocation: 'mac' },
    });

    // First request
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-1',
        approvalEventId: 'approval-dup',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
        },
      },
    });

    // Second request with same approvalEventId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-2',
        approvalEventId: 'approval-dup',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('CONFLICT');
  });

  it('returns 409 for duplicate actionId', async () => {
    // Mock dispatch to succeed for the first request
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
      ok: true,
      value: { dispatched: true, workerLocation: 'mac' },
    });

    // First request
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-action',
        approvalEventId: 'approval-1',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
        },
      },
    });

    // Second request with same actionId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-action',
        approvalEventId: 'approval-2',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('CONFLICT');
  });

  it('returns 500 when task queue is full', async () => {
    // Mock taskEnqueueService to return queue_full error
    const { getServices } = await import('../../services.js');
    const services = getServices();
    const mockEnqueue = vi.spyOn(services.taskEnqueueService, 'enqueue').mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'queue_full',
        message: 'Task queue is at capacity',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-queue-full',
        approvalEventId: 'approval-queue-full',
        userId: 'user-123',
        payload: {
          prompt: 'Test prompt',
        },
      },
    });

    expect(response.statusCode).toBe(500);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INTERNAL_ERROR');

    mockEnqueue.mockRestore();
  });

  it('returns 409 for duplicate_approval even with different linearIssueId', async () => {
    // Mock dispatch to succeed for the first request
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
      ok: true,
      value: { dispatched: true, workerLocation: 'mac' },
    });

    // Mock linearAgentClient.validateIssue to succeed for both INT-123 and INT-456
    // This is needed because Critical Fix 1 now returns error when user-provided issue ID can't be validated
    const { getServices } = await import('../../services.js');
    const services = getServices();
    const validateIssueSpy = vi.spyOn(services.linearAgentClient, 'validateIssue').mockResolvedValue({
      ok: true,
      value: {
        id: 'uuid-123',
        identifier: 'INT-123',
        title: 'First Issue',
        url: 'https://linear.app/intexuraos/INT-123',
        labels: [],
        childCount: 0,
        parentId: null,
      },
    });

    // First request with linearIssueId
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-linear-1',
        approvalEventId: 'approval-dup-linear',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
          linearIssueId: 'INT-123',
        },
      },
    });

    // Second request with same approvalEventId but different linearIssueId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-linear-2',
        approvalEventId: 'approval-dup-linear',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
          linearIssueId: 'INT-456',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('CONFLICT');

    validateIssueSpy.mockRestore();
  });

  it('returns 409 for duplicate prompt within 5 minutes (Layer 2)', async () => {
    // Mock dispatch to succeed for the first request
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
      ok: true,
      value: { dispatched: true, workerLocation: 'mac' },
    });

    // First request
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dedup-prompt-1',
        approvalEventId: 'approval-dedup-prompt-1',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the duplicate prompt bug',
        },
      },
    });

    // Second request with same prompt but different action/approval IDs
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dedup-prompt-2',
        approvalEventId: 'approval-dedup-prompt-2',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the duplicate prompt bug',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.message).toContain('Similar task submitted in last 5 minutes');
  });

  it('returns 409 for active task on same Linear issue (Layer 3)', async () => {
    // Mock dispatch to succeed but leave task in dispatched status (active)
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
      ok: true,
      value: { dispatched: true, workerLocation: 'mac' },
    });

    // Mock linearAgentClient.validateIssue for user-provided issue IDs
    const { getServices } = await import('../../services.js');
    const services = getServices();
    const validateIssueSpy = vi.spyOn(services.linearAgentClient, 'validateIssue').mockResolvedValue({
      ok: true,
      value: {
        id: 'uuid-active-issue',
        identifier: 'INT-ACTIVE',
        title: 'Active Issue',
        url: 'https://linear.app/intexuraos/INT-ACTIVE',
        labels: [],
        childCount: 0,
        parentId: null,
      },
    });

    // First request with linearIssueId
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-active-1',
        approvalEventId: 'approval-active-1',
        userId: 'user-123',
        payload: {
          prompt: 'First task for this issue',
          linearIssueId: 'INT-ACTIVE',
        },
      },
    });

    // Second request with same linearIssueId (different prompt to avoid Layer 2)
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-active-2',
        approvalEventId: 'approval-active-2',
        userId: 'user-123',
        payload: {
          prompt: 'Second different task for same issue',
          linearIssueId: 'INT-ACTIVE',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { success: boolean; error: { code: string; message: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('CONFLICT');
    expect(json.error.message).toContain('Active task already exists for this Linear issue');

    validateIssueSpy.mockRestore();
  });

  it('returns 200 with correct resourceUrl format', async () => {
    // Mock taskDispatcher to succeed
    vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
      ok: true,
      value: {
        dispatched: true,
        workerLocation: 'mac',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-resource-url',
        approvalEventId: 'approval-resource-url',
        userId: 'user-123',
        payload: {
          prompt: 'Test resource URL format',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean; data: { status: string; codeTaskId: string; resourceUrl: string } };
    expect(json.success).toBe(true);
    expect(json.data.resourceUrl).toMatch(/^\/#\/code-tasks\/[a-zA-Z0-9_-]+$/);
    // Verify resourceUrl contains the codeTaskId
    expect(json.data.resourceUrl).toContain(json.data.codeTaskId);
  });
});
