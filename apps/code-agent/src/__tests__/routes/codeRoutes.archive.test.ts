/**
 * Tests for POST /code/tasks/:taskId/archive endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';
import { ok, type Result } from '@intexuraos/common-core';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
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
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';

describe('POST /code/tasks/:taskId/archive', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Mock actions-agent HTTP calls to avoid hanging in CI
    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    // Mock linear-agent HTTP calls
    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

    // Set jwtVerify to resolve by default (simulating valid token)
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

    // Setup services with fake repository
    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<Result<DispatchResult, DispatchError>> {
        return {
          ok: true as const,
          value: {
            dispatched: true,
            workerLocation: 'mac',
          },
        };
      },
      async cancelOnWorker(): Promise<void> {
        return;
      },
      async sendMessageToWorker(): Promise<Result<{ action: 'queued' | 'resumed' }, { code: string; message: string }>> {
        return ok({ action: 'queued' });
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
      dispatchRetryRepo: {
        async findOldest() { return ok(null); },
        async create() { return ok({} as never); },
        async delete() { return ok(undefined); },
        async update() { return ok(undefined); },
      },
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: {} as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ checked: 0 }),
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
      workerSettingsRepo: WorkerSettingsRepository;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined; // @allow-undefined-type -- mirrors exact type from services.ts
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
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

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  async function createTask(userId: string): Promise<string> {
    const { codeTaskRepo } = getServices();
    const created = await codeTaskRepo.create({
      userId,
      prompt: 'Fix bug',
      sanitizedPrompt: 'fix bug',
      systemPromptHash: 'abc123',
      workerType: 'opus',
      workerLocation: 'vm',
      repository: 'test/repo',
      baseBranch: 'main',
      traceId: 'trace-archive-test',
    });
    if (!created.ok) throw new Error('Setup failed: could not create task');
    return created.value.id;
  }

  it('successfully archives a task in terminal status', async () => {
    const { codeTaskRepo } = getServices();
    const taskId = await createTask('test-user-id');

    // Move task to a terminal status first
    const updateResult = await codeTaskRepo.update(taskId, { status: 'failed' });
    if (!updateResult.ok) throw new Error('Setup failed: could not update task status');

    const response = await server.inject({
      method: 'POST',
      url: `/code/tasks/${taskId}/archive`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { success: boolean; data: { archived: boolean } };
    expect(body.success).toBe(true);
    expect(body.data.archived).toBe(true);

    // Verify task is now archived
    const findResult = await codeTaskRepo.findByIdForUser(taskId, 'test-user-id');
    if (!findResult.ok) throw new Error('Verification failed');
    expect(findResult.value.status).toBe('archived');
  });

  it('rejects archiving an active task with 400', async () => {
    const taskId = await createTask('test-user-id');

    const response = await server.inject({
      method: 'POST',
      url: `/code/tasks/${taskId}/archive`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('queued');
  });

  it('rejects archiving an already archived task with 400', async () => {
    const { codeTaskRepo } = getServices();
    const taskId = await createTask('test-user-id');

    // Move to terminal status and archive
    await codeTaskRepo.update(taskId, { status: 'failed' });

    const firstResponse = await server.inject({
      method: 'POST',
      url: `/code/tasks/${taskId}/archive`,
      headers: { authorization: 'Bearer test-token' },
    });
    expect(firstResponse.statusCode).toBe(200);

    // Try to archive again
    const response = await server.inject({
      method: 'POST',
      url: `/code/tasks/${taskId}/archive`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(body.error.message).toContain('archived');
  });

  it('rejects archiving a task owned by another user with 404', async () => {
    const taskId = await createTask('other-user-id');

    const response = await server.inject({
      method: 'POST',
      url: `/code/tasks/${taskId}/archive`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for non-existent task', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/code/tasks/non-existent-task-id/archive',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
