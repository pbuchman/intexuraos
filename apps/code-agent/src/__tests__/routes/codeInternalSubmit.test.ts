/**
 * Tests for POST /internal/code/submit endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

// Mock jose library for JWT validation (required because server imports jose at module level)
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
import { ok, err } from '@intexuraos/common-core';
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

describe('POST /internal/code/submit', () => {
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

    // Set up worker settings for the test user (user-123, used by codeProcess tests pattern)
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

  it('rejects requests without internal auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the login bug',
      },
      // No x-internal-auth header
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with invalid internal auth token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the login bug',
      },
      headers: {
        'x-internal-auth': 'wrong-token',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });

  it('rejects requests missing userId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        prompt: 'Fix the login bug',
      },
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });

  it('rejects requests missing prompt', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
      },
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
  });

  it('successfully creates a code task with valid internal auth', async () => {
    // Seed worker settings for the user using the repository (same pattern as codeProcess.test.ts)
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the login bug',
      },
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('submitted');
    expect(body.data.codeTaskId).toMatch(/^task_/);
  });

  it('passes optional workerType and linearIssueId', async () => {
    // Seed worker settings for the user using the repository (same pattern as codeProcess.test.ts)
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Mock the linear-agent GET validate endpoint for INT-999
    nock('http://linear-agent:8086')
      .get(/\/internal\/linear\/issues\/INT-999\/validate/)
      .reply(200, {
        success: true,
        data: {
          id: 'linear-id-999',
          identifier: 'INT-999',
          title: 'Test Linear Issue',
          url: 'https://linear.app/intexuraos/issue/INT-999',
          labels: [],
          childCount: 0,
        },
      });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the login bug',
        workerType: 'opus',
        linearIssueId: 'INT-999',
      },
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.codeTaskId).toMatch(/^task_/);
  });

  it('returns 424 when user has no workers configured', async () => {
    // No workers seeded for test-user-id — getSettings returns null (no doc),
    // which processCodeAction treats the same as empty workers → worker_not_configured

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the login bug',
      },
      headers: {
        'x-internal-auth': 'test-internal-token',
      },
    });

    expect(response.statusCode).toBe(424);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('WORKER_NOT_CONFIGURED');
  });

  it('returns 409 for duplicate_prompt when same prompt is submitted twice', async () => {
    // Seed worker settings for the user
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // First submission — should succeed
    const first = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: { userId: 'test-user-id', prompt: 'Fix the login bug for duplicate test' },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });
    expect(first.statusCode).toBe(200);

    // Second submission with identical prompt — triggers duplicate_prompt dedup
    const second = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: { userId: 'test-user-id', prompt: 'Fix the login bug for duplicate test' },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('Similar task');
  });

  it('returns 409 for active_task_exists when same linearIssueId is submitted twice', async () => {
    // Seed worker settings for the user
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Mock the linear-agent GET validate endpoint for INT-888
    nock('http://linear-agent:8086')
      .persist()
      .get(/\/internal\/linear\/issues\/INT-888\/validate/)
      .reply(200, {
        success: true,
        data: {
          id: 'linear-id-888',
          identifier: 'INT-888',
          title: 'Test Linear Issue',
          url: 'https://linear.app/intexuraos/issue/INT-888',
          labels: [],
          childCount: 0,
        },
      });

    // First submission with linearIssueId — should succeed
    const first = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'First prompt for active task test',
        linearIssueId: 'INT-888',
      },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });
    expect(first.statusCode).toBe(200);

    // Second submission with same linearIssueId — triggers active_task_exists dedup
    const second = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Second different prompt for same issue',
        linearIssueId: 'INT-888',
      },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toContain('Active task already exists');
  });

  it('returns 400 for validation_error when prompt contains base64 blob', async () => {
    // Seed worker settings for the user
    const { getServices } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Create a prompt with a base64 blob (3000+ chars triggers rejection)
    const base64Blob = 'A'.repeat(3100);
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: `Fix this: ${base64Blob}`,
      },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 503 for queue_full when enqueue service reports full queue', async () => {
    // Seed worker settings for the user
    const { getServices, setServices: setServicesLocal } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Override taskEnqueueService to return queue_full error
    setServicesLocal({
      ...services,
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(
          err({ code: 'queue_full', message: 'Queue is full (11/10). Please try again later.' })
        ),
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the queue full bug',
      },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('QUEUE_FULL');
  });

  it('returns 500 for internal_error when enqueue fails with non-queue_full error', async () => {
    // Seed worker settings for the user
    const { getServices, setServices: setServicesLocal } = await import('../../services.js');
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'test-worker',
      url: 'https://test-worker.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    // Override taskEnqueueService to return internal_error (not queue_full)
    setServicesLocal({
      ...services,
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(
          err({ code: 'internal_error', message: 'Enqueue failed unexpectedly' })
        ),
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/submit',
      payload: {
        userId: 'test-user-id',
        prompt: 'Fix the internal error bug',
      },
      headers: { 'x-internal-auth': 'test-internal-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
