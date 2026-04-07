/**
 * Tests for POST /internal/code/group-summary/recompute endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { buildServer } from '../../../server.js';
import { resetServices, setServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../../helpers/mockServices.js';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../../infra/repositories/firestoreLogLineRepository.js';
import { createWhatsAppNotifier } from '../../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from '../../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../../domain/usecases/archiveStaleGroups.js';
import { createAutoArchiveMergedTasksUseCase } from '../../../domain/usecases/autoArchiveMergedTasks.js';
import { createNoOpMetricsClient } from '../../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import type { TaskDispatcherService, DispatchResult } from '../../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createFakeTaskGroupSummaryRepository } from '../../fakes/fakeTaskGroupSummaryRepository.js';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTask } from '../../../domain/models/codeTask.js';

describe('POST /internal/code/group-summary/recompute', () => {
  const sourceTimestamp = '2026-04-02T12:34:56.000Z';

  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let groupSummaryRepo: ReturnType<typeof createFakeTaskGroupSummaryRepository>;

  function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    return {
      id: 'task-1',
      traceId: 'trace-1',
      userId: 'user-1',
      workerType: 'sonnet',
      workerLocation: 'home-dev',
      status: 'planned',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'abc123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      dedupKey: 'abc123',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    groupSummaryRepo = createFakeTaskGroupSummaryRepository();

    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<ReturnType<typeof ok<DispatchResult>>> {
        return ok({ dispatched: true, workerLocation: 'mac' });
      },
      async cancelOnWorker(): Promise<void> {
        return;
      },
      async sendMessageToWorker(): Promise<ReturnType<typeof ok<{ action: 'queued' | 'resumed' }>>> {
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
      async checkLimits() { return ok(undefined); },
      async recordTaskStart() { return; },
      async recordTaskComplete() { return; },
    };

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({ linearAgentClient, logger });
    const gitHubPREventRepo = createFirestoreGitHubPREventsRepository({ logger });

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
      statusMirrorService: createStatusMirrorService({ actionsAgentClient, logger }),
      processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      autoArchiveMergedTasks: createAutoArchiveMergedTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo,
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
      groupSummaryRepo,
    });

    server = await buildServer();
  });

  afterEach(() => {
    nock.cleanAll();
    resetServices();
    resetFirestore();
    groupSummaryRepo.reset();
    vi.clearAllMocks();
  });

  it('returns 401 without X-Internal-Auth header', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-100',
        labels: [],
        sourceTimestamp,
      },
    });

    expect(response.statusCode).toBe(401);
    const json = response.json() as { success: boolean; error: { code: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 404 when no group summary exists for the given userId/linearIssueId', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      headers: { 'X-Internal-Auth': 'test-internal-token' },
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-MISSING',
        labels: [],
        sourceTimestamp,
      },
    });

    expect(response.statusCode).toBe(404);
    const json = response.json() as { success: boolean; error: { code: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 and recomputes when group summary exists', async () => {
    // Set up a group summary in the fake repo
    const task = makeTask({
      userId: 'user-1',
      linearIssueId: 'INT-100',
      agentType: 'planning',
      status: 'planned',
    });
    await groupSummaryRepo.updateAfterCreate(task);

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      headers: { 'X-Internal-Auth': 'test-internal-token' },
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-100',
        labels: [{ id: 'lbl-1', name: 'ready-to-implement' }],
        sourceTimestamp,
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean; data: { status: string } };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('recomputed');
  });

  it('passes the caller-provided source timestamp to recomputeWithLabels', async () => {
    const repoSpy = vi.spyOn(groupSummaryRepo, 'recomputeWithLabels');
    const task = makeTask({
      userId: 'user-1',
      linearIssueId: 'INT-TIME',
      agentType: 'planning',
      status: 'planned',
    });
    await groupSummaryRepo.updateAfterCreate(task);

    await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      headers: { 'X-Internal-Auth': 'test-internal-token' },
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-TIME',
        labels: [{ id: 'lbl-1', name: 'ready-to-implement' }],
        sourceTimestamp,
      },
    });

    expect(repoSpy).toHaveBeenCalledWith(
      'user-1',
      'INT-TIME',
      [{ id: 'lbl-1', name: 'ready-to-implement' }],
      sourceTimestamp,
    );
  });

  it('updates the group summary label flags in the repo', async () => {
    const task = makeTask({
      userId: 'user-1',
      linearIssueId: 'INT-200',
      agentType: 'planning',
      status: 'planned',
    });
    await groupSummaryRepo.updateAfterCreate(task);

    await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      headers: { 'X-Internal-Auth': 'test-internal-token' },
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-200',
        labels: [{ id: 'lbl-merge', name: 'ready-to-merge' }],
        sourceTimestamp,
      },
    });

    const summary = groupSummaryRepo.getSummary('user-1', 'INT-200');
    expect(summary?.hasImplementationReadyLabel).toBe(false);
    expect(summary?.hasMergeReadyLabel).toBe(true);
  });

  it('returns 500 when recomputeWithLabels returns FIRESTORE_ERROR', async () => {
    // Monkey-patch the repo to simulate a Firestore error
    const original = groupSummaryRepo.recomputeWithLabels;
    groupSummaryRepo.recomputeWithLabels = async (): ReturnType<typeof original> =>
      err({ code: 'FIRESTORE_ERROR', message: 'Transaction failed' });

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/group-summary/recompute',
      headers: { 'X-Internal-Auth': 'test-internal-token' },
      payload: {
        userId: 'user-1',
        linearIssueId: 'INT-999',
        labels: [],
        sourceTimestamp,
      },
    });

    expect(response.statusCode).toBe(500);
    const json = response.json() as { success: boolean; error: { code: string } };
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('INTERNAL_ERROR');

    // Restore
    groupSummaryRepo.recomputeWithLabels = original;
  });
});
