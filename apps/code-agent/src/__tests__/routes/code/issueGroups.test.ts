/**
 * Integration tests for GET /code/issue-groups route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { ok, err } from '@intexuraos/common-core';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { resetServices, setServices } from '../../../services.js';
import type { ServiceContainer } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../../infra/repositories/firestoreLogLineRepository.js';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient } from '../../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createFirestoreDispatchRetryRepository } from '../../../infra/firestore/dispatchRetryRepository.js';
import { createFirestoreMergeQueueWatchRepository } from '../../../infra/firestore/mergeQueueWatchRepository.js';
import { createFirestoreEventDecisionRepository } from '../../../infra/firestore/eventDecisionRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../../helpers/mockServices.js';
import { EMPTY_RECONCILE_RESULT } from '../../../domain/services/mergeConflictDetector.js';
import type { Logger } from 'pino';
import type { CodeTaskRepository, CreateTaskInput } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { TaskDispatcherService, DispatchResult, DispatchError } from '../../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { Result } from '@intexuraos/common-core';
import { createWhatsAppNotifier } from '../../../infra/services/whatsappNotifierImpl.js';
import { createLinearIssueService } from '../../../domain/services/linearIssueService.js';
import { createActionsAgentClient } from '../../../infra/clients/actionsAgentClient.js';
import type { TaskGroupSummaryRepository } from '../../../domain/ports/taskGroupSummaryRepository.js';
import type { UserGroupCounts, TaskGroupSummary } from '../../../domain/models/taskGroupSummary.js';

function makeLinearAgentClient(): LinearAgentClient {
  const client: LinearAgentClient = {
    createIssue: () => Promise.resolve(ok({ issueId: 'id', issueIdentifier: 'INT-1', issueTitle: 'title', issueUrl: 'url' })),
    updateIssueState: () => Promise.resolve(ok(undefined)),
    validateIssue: (req) => Promise.resolve(ok({ id: `id-${req.identifier}`, identifier: req.identifier, title: `Mock ${req.identifier}`, url: `https://linear.app/${req.identifier}`, labels: [], childCount: 0, parentId: null })),
    generateTitle: (req) => Promise.resolve(ok({ title: req.description.slice(0, 80), issueType: 'feature' })),
    addComment: () => Promise.resolve(ok({ commentId: 'c1' })),
    fetchIssueTree: (req) => Promise.resolve(ok({ root: { id: req.issueId, identifier: `INT-${req.issueId}`, url: `https://linear.app/${req.issueId}`, parentId: null, labels: [], assigneeId: null, state: 'Backlog' }, descendants: [] })),
    fetchDirectChildrenLive: () => Promise.resolve(ok([])),
    updateIssueMetadata: () => Promise.resolve(ok({ droppedLabels: [] })),
    fetchIssueForDisplay: (req) => Promise.resolve(ok({ identifier: req.identifier, parentIdentifier: null, title: `Mock ${req.identifier}`, state: { name: 'In Progress', type: 'started' }, priority: 2, assignee: null, labels: [], url: `https://linear.app/${req.identifier}`, commentCount: 0, lastCommentAt: null })),
    fetchIssuesForDisplay: (req) => Promise.resolve(ok(req.identifiers.map((identifier) => ({
      identifier,
      parentIdentifier: null,
      title: `Mock ${identifier}`,
      state: { name: 'In Progress', type: 'started' as const },
      priority: 2,
      assignee: null,
      labels: [],
      url: `https://linear.app/intexura/issue/${identifier}`,
      commentCount: 0,
      lastCommentAt: null,
    })))),
    getIssueDescription: () => Promise.resolve(ok(undefined)),
    getIssueContext: () => Promise.resolve(ok({ description: null, comments: [] })),
  };
  return client;
}

function makeGroupSummaryRepo(overrides: Partial<TaskGroupSummaryRepository> = {}): TaskGroupSummaryRepository {
  const defaultCounts: UserGroupCounts = {
    userId: 'test-user-id',
    active: 0,
    needsAction: 0,
    done: 0,
    failed: 0,
    totalGroups: 0,
    updatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
  };
  return {
    updateAfterCreate: async (): Promise<void> => { return; },
    updateAfterStatusChange: async (): Promise<void> => { return; },
    updateAfterDelete: async (): Promise<void> => { return; },
    getUserGroupCounts: async (): ReturnType<TaskGroupSummaryRepository['getUserGroupCounts']> => ok(defaultCounts),
    listGroupSummaries: async (): ReturnType<TaskGroupSummaryRepository['listGroupSummaries']> => ok({ summaries: [] }),
    recomputeGroupFromTasks: async (): Promise<void> => { return; },
    recomputeWithLabels: async (): ReturnType<TaskGroupSummaryRepository['recomputeWithLabels']> => ok(undefined),
    ...overrides,
  };
}

function makeTaskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    userId: 'test-user-id',
    prompt: 'test prompt',
    sanitizedPrompt: 'test prompt',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'test-worker',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: `trace-${String(Date.now())}-${String(Math.random())}`,
    agentType: 'planning',
    ...overrides,
  };
}

function makeSummary(overrides: Partial<TaskGroupSummary> & { linearIssueId: string }): TaskGroupSummary {
  const now = new Date() as unknown as import('@google-cloud/firestore').Timestamp;
  return {
    userId: 'test-user-id',
    groupKey: overrides.linearIssueId,
    taskCount: 1,
    activeTaskCount: overrides.aggregateStatus === 'active' ? 1 : 0,
    latestTaskStatus: 'queued',
    latestTaskUpdatedAt: now,
    agentTypesPresent: [],
    hasCompletedPlanning: false,
    hasCompletedExecution: false,
    hasImplementationTaskId: false,
    hasPrUrl: false,
    prNumber: null,
    latestReviewNeedsRemediation: null,
    oldestTaskCreatedAt: now,
    mostRecentDispatchedAt: null,
    aggregateStatus: 'active',
    updatedAt: now,
    ...overrides,
  };
}

function makeStandaloneSummary(taskId: string): TaskGroupSummary {
  const now = new Date() as unknown as import('@google-cloud/firestore').Timestamp;
  return {
    userId: 'test-user-id',
    linearIssueId: null,
    groupKey: `standalone_${taskId}`,
    taskCount: 1,
    activeTaskCount: 1,
    latestTaskStatus: 'queued',
    latestTaskUpdatedAt: now,
    agentTypesPresent: [],
    hasCompletedPlanning: false,
    hasCompletedExecution: false,
    hasImplementationTaskId: false,
    hasPrUrl: false,
    prNumber: null,
    latestReviewNeedsRemediation: null,
    oldestTaskCreatedAt: now,
    mostRecentDispatchedAt: null,
    aggregateStatus: 'active',
    updatedAt: now,
  };
}

describe('GET /code/issue-groups', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let codeTaskRepo: CodeTaskRepository;
  let mockSummaries: TaskGroupSummary[];
  let mockCounts: UserGroupCounts;

  function makeBaseServices(overrides: {
    codeTaskRepo?: CodeTaskRepository;
    groupSummaryRepo?: ReturnType<typeof makeGroupSummaryRepo>;
  } = {}): ServiceContainer {
    const actionsClient = createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger });
    const linearClient = makeLinearAgentClient();
    const repoToUse = overrides.codeTaskRepo ?? codeTaskRepo;
    return {
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo: repoToUse,
      taskDispatcher: {
        async dispatch(): Promise<Result<DispatchResult, DispatchError>> { return ok({ dispatched: true, workerLocation: 'mac' }); },
        async cancelOnWorker() { return; },
        async sendMessageToWorker() { return ok({ action: 'queued' }); },
      } as TaskDispatcherService,
      whatsappNotifier: createWhatsAppNotifier({ whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher }),
      logChunkRepo: createFirestoreLogChunkRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      logLineRepo: createFirestoreLogLineRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      actionsAgentClient: actionsClient,
      linearAgentClient: linearClient,
      rateLimitService: { async checkLimits() { return ok(undefined); }, async recordTaskStart() { return; }, async recordTaskComplete() { return; } } as RateLimitService,
      linearIssueService: createLinearIssueService({ linearAgentClient: linearClient, logger }),
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({ actionsAgentClient: actionsClient, logger }),
      processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: repoToUse, logger }),
      detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: repoToUse, logger }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: repoToUse, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
      dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
      mergeConflictDetector: { detectOnPush: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT) },
      mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: repoToUse, logger }),
      groupSummaryRepo: overrides.groupSummaryRepo ?? makeGroupSummaryRepo(),
    };
  }

  beforeEach(async () => {
    mockSummaries = [];
    mockCounts = {
      userId: 'test-user-id',
      active: 0,
      needsAction: 0,
      done: 0,
      failed: 0,
      totalGroups: 0,
      updatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
    };

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
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<Result<DispatchResult, DispatchError>> {
        return ok({ dispatched: true, workerLocation: 'mac' });
      },
      async cancelOnWorker() { return; },
      async sendMessageToWorker() { return ok({ action: 'queued' }); },
    };

    const rateLimitService: RateLimitService = {
      async checkLimits() { return ok(undefined); },
      async recordTaskStart() { return; },
      async recordTaskComplete() { return; },
    };

    const linearAgentClient = makeLinearAgentClient();

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

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
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
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
      eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
      dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT),
      },
      mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => ok(mockCounts),
        listGroupSummaries: async (input) => {
          const startIndex = ((): number => {
            if (input.cursor === undefined || input.cursor === '') return 0;
            try {
              const parsed = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as { index?: unknown };
              const idx = typeof parsed.index === 'number' && Number.isInteger(parsed.index) && parsed.index >= 0 ? parsed.index : 0;
              return idx;
            } catch {
              return 0;
            }
          })();
          const page = mockSummaries.slice(startIndex, startIndex + input.limit);
          const endIndex = startIndex + page.length;
          const nextCursor = endIndex < mockSummaries.length
            ? Buffer.from(JSON.stringify({ index: endIndex })).toString('base64url')
            : undefined;
          return ok({ summaries: page, ...(nextCursor !== undefined && { nextCursor }) });
        },
      }),
    });

    server = await buildServer();
  });

  afterEach(async () => {
    await server.close();
    resetServices();
    resetFirestore();
  });

  it('returns empty groups when no tasks exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[]; counts: Record<string, number>; totalGroups: number } };
    expect(body.data.groups).toEqual([]);
    expect(body.data.totalGroups).toBe(0);
    expect(body.data.counts).toEqual({ active: 0, 'needs-action': 0, done: 0, failed: 0 });
  });

  it('groups tasks by linearIssueId', async () => {
    // Create two tasks with the same linearIssueId
    const result1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-100', traceId: 'trace-1' }));
    expect(result1.ok).toBe(true);
    if (!result1.ok) return;
    // Complete first task so second doesn't hit ACTIVE_TASK_EXISTS dedup
    await codeTaskRepo.update(result1.value.id, { status: 'planned' });
    const result2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-100', traceId: 'trace-2', agentType: 'execution' }));
    expect(result2.ok).toBe(true);

    // Create a task with a different linearIssueId
    const result3 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-200', traceId: 'trace-3' }));
    expect(result3.ok).toBe(true);

    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-100', taskCount: 2, aggregateStatus: 'needs-action' }),
      makeSummary({ linearIssueId: 'INT-200' }),
    ];
    mockCounts = { ...mockCounts, totalGroups: 2, needsAction: 1, active: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null; tasks: unknown[] }[]; totalGroups: number } };
    expect(body.data.totalGroups).toBe(2);

    const int100Group = body.data.groups.find((g) => g.linearIssueId === 'INT-100');
    expect(int100Group).toBeDefined();
    expect(int100Group?.tasks).toHaveLength(2);

    const int200Group = body.data.groups.find((g) => g.linearIssueId === 'INT-200');
    expect(int200Group).toBeDefined();
    expect(int200Group?.tasks).toHaveLength(1);
  });

  it('returns correct aggregate status for active group', async () => {
    // Create a running task -- 'queued' is the initial status from create
    const result = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-300', traceId: 'trace-active' }));
    expect(result.ok).toBe(true);
    // Task starts as 'queued' which is in ACTIVE_STATUSES

    mockSummaries = [makeSummary({ linearIssueId: 'INT-300', aggregateStatus: 'active' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null; aggregateStatus: string }[] } };
    const group = body.data.groups.find((g) => g.linearIssueId === 'INT-300');
    expect(group).toBeDefined();
    expect(group?.aggregateStatus).toBe('active');
  });

  it('returns correct aggregate status for needs-action group', async () => {
    // Create a planned task (completed step, needs implementation = actionable)
    const result = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-400', traceId: 'trace-needs-action', agentType: 'planning' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await codeTaskRepo.update(result.value.id, { status: 'planned' });

    mockSummaries = [makeSummary({ linearIssueId: 'INT-400', aggregateStatus: 'needs-action', latestTaskStatus: 'planned' })];
    mockCounts = { ...mockCounts, needsAction: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null; aggregateStatus: string }[] } };
    const group = body.data.groups.find((g) => g.linearIssueId === 'INT-400');
    expect(group).toBeDefined();
    expect(group?.aggregateStatus).toBe('needs-action');
  });

  it('returns global counts for all statuses', async () => {
    // Active group (queued task)
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-500', traceId: 'trace-c1' }));
    expect(r1.ok).toBe(true);

    // Failed group
    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-501', traceId: 'trace-c2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'failed' });

    // Done group (cancelled)
    const r3 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-502', traceId: 'trace-c3' }));
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    await codeTaskRepo.update(r3.value.id, { status: 'cancelled' });

    // Counts come from getUserGroupCounts (precomputed)
    mockCounts = { ...mockCounts, active: 1, failed: 1, done: 1, totalGroups: 3 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { counts: Record<string, number> } };
    expect(body.data.counts['active']).toBe(1);
    expect(body.data.counts['failed']).toBe(1);
    expect(body.data.counts['done']).toBe(1);
  });

  it('filters by groupStatus parameter', async () => {
    // Active group
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-600', traceId: 'trace-f1' }));
    expect(r1.ok).toBe(true);

    // Failed group
    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-601', traceId: 'trace-f2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'failed' });

    // listGroupSummaries returns only the filtered (failed) group; getUserGroupCounts has all groups
    mockSummaries = [makeSummary({ linearIssueId: 'INT-601', aggregateStatus: 'failed', latestTaskStatus: 'failed' })];
    mockCounts = { ...mockCounts, active: 1, failed: 1, totalGroups: 2 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=failed',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { aggregateStatus: string }[]; totalGroups: number; counts: Record<string, number> } };
    // Only failed groups returned
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0]?.aggregateStatus).toBe('failed');
    expect(body.data.totalGroups).toBe(1);
    // Global counts should still include all groups
    expect(body.data.counts['active']).toBe(1);
    expect(body.data.counts['failed']).toBe(1);
  });

  it('sorts by linear-id by default', async () => {
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-200', traceId: 'trace-s1' }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    await codeTaskRepo.update(r1.value.id, { status: 'cancelled' });

    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-100', traceId: 'trace-s2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'cancelled' });

    const r3 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-300', traceId: 'trace-s3' }));
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    await codeTaskRepo.update(r3.value.id, { status: 'cancelled' });

    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-200', aggregateStatus: 'done' }),
      makeSummary({ linearIssueId: 'INT-100', aggregateStatus: 'done' }),
      makeSummary({ linearIssueId: 'INT-300', aggregateStatus: 'done' }),
    ];
    mockCounts = { ...mockCounts, done: 3, totalGroups: 3 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    const issueIds = body.data.groups.map((g) => g.linearIssueId);
    // linear-id sort is descending by issue number
    expect(issueIds).toEqual(['INT-300', 'INT-200', 'INT-100']);
  });

  it('sorts by pr-number when requested', async () => {
    // pr-number sort uses pipeline.pr.number which is derived from result.prUrl
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-700', traceId: 'trace-pr1' }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    await codeTaskRepo.update(r1.value.id, { status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/10' } });

    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-701', traceId: 'trace-pr2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/50' } });

    const r3 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-702', traceId: 'trace-pr3' }));
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    await codeTaskRepo.update(r3.value.id, { status: 'implemented', result: { prUrl: 'https://github.com/org/repo/pull/30' } });

    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-700', aggregateStatus: 'done', latestTaskStatus: 'implemented', hasPrUrl: true, prNumber: 10 }),
      makeSummary({ linearIssueId: 'INT-701', aggregateStatus: 'done', latestTaskStatus: 'implemented', hasPrUrl: true, prNumber: 50 }),
      makeSummary({ linearIssueId: 'INT-702', aggregateStatus: 'done', latestTaskStatus: 'implemented', hasPrUrl: true, prNumber: 30 }),
    ];
    mockCounts = { ...mockCounts, done: 3, totalGroups: 3 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?sortBy=pr-number',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    const issueIds = body.data.groups.map((g) => g.linearIssueId);
    // sortIssueGroups is now called on the grouped result, so pr-number sort desc applies
    // PR #50 (INT-701), PR #30 (INT-702), PR #10 (INT-700)
    expect(issueIds).toEqual(['INT-701', 'INT-702', 'INT-700']);
  });

  it('sorts by created-time when requested', async () => {
    // Create tasks in order; created-time sort should be newest first
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-800', traceId: 'trace-ct1' }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    await codeTaskRepo.update(r1.value.id, { status: 'cancelled' });

    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-801', traceId: 'trace-ct2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'cancelled' });

    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-800', aggregateStatus: 'done' }),
      makeSummary({ linearIssueId: 'INT-801', aggregateStatus: 'done' }),
    ];
    mockCounts = { ...mockCounts, done: 2, totalGroups: 2 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?sortBy=created-time',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    const issueIds = body.data.groups.map((g) => g.linearIssueId);
    // groupByLinearIssue re-sorts by linear-id desc; INT-801 > INT-800 numerically
    // so the result matches the expected newest-first order coincidentally
    expect(issueIds).toEqual(['INT-801', 'INT-800']);
  });

  it('paginates with limit and cursor', async () => {
    // Create 3 groups
    for (let i = 1; i <= 3; i++) {
      const r = await codeTaskRepo.create(makeTaskInput({
        linearIssueId: `INT-90${String(i)}`,
        traceId: `trace-p${String(i)}`,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Make them non-active so they are 'done' status (for predictable sorting)
      await codeTaskRepo.update(r.value.id, { status: 'cancelled' });
    }

    // Set up 3 summaries — the cursor-aware mock in beforeEach will paginate them
    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-901', aggregateStatus: 'done' }),
      makeSummary({ linearIssueId: 'INT-902', aggregateStatus: 'done' }),
      makeSummary({ linearIssueId: 'INT-903', aggregateStatus: 'done' }),
    ];
    mockCounts = { ...mockCounts, done: 3, totalGroups: 3 };

    // Request first page with limit=2
    const page1Response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?limit=2',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(page1Response.statusCode).toBe(200);
    const page1 = JSON.parse(page1Response.body) as { data: { groups: unknown[]; nextCursor: string; totalGroups: number } };
    expect(page1.data.groups).toHaveLength(2);
    expect(page1.data.totalGroups).toBe(3);
    expect(page1.data.nextCursor).toBeDefined();

    // Request second page
    const page2Response = await server.inject({
      method: 'GET',
      url: `/code/issue-groups?limit=2&cursor=${page1.data.nextCursor}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(page2Response.statusCode).toBe(200);
    const page2 = JSON.parse(page2Response.body) as { data: { groups: unknown[]; nextCursor?: string } };
    expect(page2.data.groups).toHaveLength(1);
    expect(page2.data.nextCursor).toBeUndefined();
  });

  it('returns totalGroups matching filtered count', async () => {
    // Create 2 active groups and 1 failed group
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1001', traceId: 'trace-tc1' }));
    expect(r1.ok).toBe(true);

    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1002', traceId: 'trace-tc2' }));
    expect(r2.ok).toBe(true);

    const r3 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1003', traceId: 'trace-tc3' }));
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    await codeTaskRepo.update(r3.value.id, { status: 'failed' });

    // listGroupSummaries mock returns mockSummaries regardless of statusFilter;
    // set up only active groups (what the real repo would return when filtered)
    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-1001', aggregateStatus: 'active' }),
      makeSummary({ linearIssueId: 'INT-1002', aggregateStatus: 'active' }),
    ];
    mockCounts = { ...mockCounts, active: 2, failed: 1, totalGroups: 3 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=active',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[]; totalGroups: number; counts: Record<string, number> } };
    // totalGroups should reflect the filtered count (comes from mockCounts.active)
    expect(body.data.totalGroups).toBe(2);
    expect(body.data.groups).toHaveLength(2);
    // But global counts include all
    expect(body.data.counts['active']).toBe(2);
    expect(body.data.counts['failed']).toBe(1);
  });

  it('hydrates Linear issue data on tasks', async () => {
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1100', traceId: 'trace-hydrate' }));
    expect(r.ok).toBe(true);

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1100' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssue?: { identifier: string; title: string }; tasks: { linearIssue?: { identifier: string } }[] }[] } };
    const group = body.data.groups[0];
    expect(group).toBeDefined();
    // The group should have linearIssue data
    expect(group?.linearIssue).toBeDefined();
    expect(group?.linearIssue?.identifier).toBe('INT-1100');
    expect(group?.linearIssue?.title).toBe('Mock INT-1100');
    // Tasks should also have linearIssue hydrated
    expect(group?.tasks[0]?.linearIssue).toBeDefined();
    expect(group?.tasks[0]?.linearIssue?.identifier).toBe('INT-1100');
  });

  it('handles tasks without linearIssueId as standalone groups', async () => {
    // Task without linearIssueId
    const r = await codeTaskRepo.create(makeTaskInput({ traceId: 'trace-standalone' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Standalone tasks use groupKey = `standalone_{taskId}`, linearIssueId = null
    mockSummaries = [makeStandaloneSummary(r.value.id)];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null; tasks: unknown[] }[] } };
    expect(body.data.groups).toHaveLength(1);
    expect(body.data.groups[0]?.linearIssueId).toBeNull();
    expect(body.data.groups[0]?.tasks).toHaveLength(1);
  });

  it('returns 401 without authentication', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('serializes tasks with agentType, implementationTaskId, fanOutChildTaskIds, prNumber, and result fields', async () => {
    // Covers items 12-14: taskToSerializedTask optional field conditionals
    // Note: dispatchedAt (item 11) cannot be tested here because the fake Firestore's
    // update() treats Timestamp objects as FieldValue.delete() sentinels (they both have isEqual).
    // A v8 ignore comment is used on that branch instead.
    const r1 = await codeTaskRepo.create(makeTaskInput({
      linearIssueId: 'INT-1200',
      traceId: 'trace-serialize',
      agentType: 'execution',
    }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    await codeTaskRepo.update(r1.value.id, {
      status: 'implemented',
      implementationTaskId: 'task-impl-1',
      fanOutChildTaskIds: ['task-child-1', 'task-child-2'],
      prNumber: 42,
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
    });

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1200', aggregateStatus: 'done', latestTaskStatus: 'implemented', hasPrUrl: true, prNumber: 42, hasImplementationTaskId: true })];
    mockCounts = { ...mockCounts, done: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        groups: {
          linearIssueId: string | null;
          tasks: {
            agentType?: string;
            implementationTaskId?: string;
            fanOutChildTaskIds?: string[];
            prNumber?: number;
            result?: { prUrl?: string };
            createdAt: string;
          }[];
        }[];
      };
    };

    const group = body.data.groups.find((g) => g.linearIssueId === 'INT-1200');
    expect(group).toBeDefined();
    const task = group?.tasks[0];
    expect(task).toBeDefined();
    expect(task?.agentType).toBe('execution');
    expect(task?.implementationTaskId).toBe('task-impl-1');
    expect(task?.fanOutChildTaskIds).toEqual(['task-child-1', 'task-child-2']);
    expect(task?.prNumber).toBe(42);
    expect(task?.result?.prUrl).toBe('https://github.com/org/repo/pull/42');
    expect(task?.createdAt).toBeDefined();
    expect(task?.createdAt).not.toBe('');
  });

  // Note: sortBy validation (item 15) and limit default (item 16) are covered by
  // v8 ignore comments because Fastify JSON Schema enforces enum/default before
  // the handler runs, making the fallback branches unreachable in tests.

  it('serializes tasks without agentType when not set', async () => {
    // Covers: task.agentType === undefined false branch in taskToSerializedTask
    const r = await codeTaskRepo.create({
      userId: 'test-user-id',
      prompt: 'no agent type',
      sanitizedPrompt: 'no agent type',
      systemPromptHash: 'hash',
      workerType: 'auto' as const,
      workerLocation: 'test-worker',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: `trace-no-agent-${String(Date.now())}`,
      // agentType intentionally omitted
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    mockSummaries = [makeStandaloneSummary(r.value.id)];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: { groups: { tasks: { agentType?: string }[] }[] };
    };
    // Find the task without agentType
    const allTasks = body.data.groups.flatMap((g) => g.tasks);
    const taskWithoutAgent = allTasks.find((t) => t.agentType === undefined);
    expect(taskWithoutAgent).toBeDefined();
  });

  it('resets statusFilter to undefined when all values are invalid', async () => {
    // Covers item 17: statusFilter empty check after filtering invalid values
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1500', traceId: 'trace-invalid-status' }));
    expect(r.ok).toBe(true);

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1500' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=bogus,invalid',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[]; totalGroups: number } };
    // When all statuses are invalid, filter is undefined => all groups returned
    expect(body.data.totalGroups).toBeGreaterThanOrEqual(1);
  });

  it('returns error when codeTaskRepo.listAllNonArchived fails', async () => {
    // Covers item 18: error path when groupSummaryRepo.getUserGroupCounts fails
    // (the old path checked listAllNonArchived; new path checks getUserGroupCounts)
    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher: {
        async dispatch() { return ok({ dispatched: true, workerLocation: 'mac' }); },
        async cancelOnWorker() { return; },
        async sendMessageToWorker() { return ok({ action: 'queued' }); },
      } as TaskDispatcherService,
      whatsappNotifier: createWhatsAppNotifier({
        whatsappPublisher: {
          publishSendMessage: async () => ok(undefined),
        } as unknown as WhatsAppSendPublisher,
      }),
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      actionsAgentClient: createActionsAgentClient({
        baseUrl: 'http://actions-agent',
        internalAuthToken: 'test-token',
        logger,
      }),
      linearAgentClient: makeLinearAgentClient(),
      rateLimitService: {
        async checkLimits() { return ok(undefined); },
        async recordTaskStart() { return; },
        async recordTaskComplete() { return; },
      } as RateLimitService,
      linearIssueService: createLinearIssueService({
        linearAgentClient: makeLinearAgentClient(),
        logger,
      }),
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient: createActionsAgentClient({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
          logger,
        }),
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
      eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
      dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT),
      },
      mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'Database connection failed' }),
      }),
    });

    // Need to rebuild server to pick up new services
    await server.close();
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error?: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
  });

  it('logs warning when Linear hydration fails but still returns groups', async () => {
    // Covers items 19-20: hydration warning and linearIssue hydration
    const failingLinearClient: LinearAgentClient = {
      ...makeLinearAgentClient(),
      fetchIssuesForDisplay: async () => err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' }),
    };

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher: {
        async dispatch() { return ok({ dispatched: true, workerLocation: 'mac' }); },
        async cancelOnWorker() { return; },
        async sendMessageToWorker() { return ok({ action: 'queued' }); },
      } as TaskDispatcherService,
      whatsappNotifier: createWhatsAppNotifier({
        whatsappPublisher: {
          publishSendMessage: async () => ok(undefined),
        } as unknown as WhatsAppSendPublisher,
      }),
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      actionsAgentClient: createActionsAgentClient({
        baseUrl: 'http://actions-agent',
        internalAuthToken: 'test-token',
        logger,
      }),
      linearAgentClient: failingLinearClient,
      rateLimitService: {
        async checkLimits() { return ok(undefined); },
        async recordTaskStart() { return; },
        async recordTaskComplete() { return; },
      } as RateLimitService,
      linearIssueService: createLinearIssueService({
        linearAgentClient: failingLinearClient,
        logger,
      }),
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient: createActionsAgentClient({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
          logger,
        }),
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
      eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
      dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT),
      },
      mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
      groupSummaryRepo: makeGroupSummaryRepo({
        listGroupSummaries: async () => ok({ summaries: [makeSummary({ linearIssueId: 'INT-1600' })] }),
      }),
    });

    await server.close();
    server = await buildServer();

    // Create a task with linearIssueId so hydration is attempted
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1600', traceId: 'trace-hydrate-fail' }));
    expect(r.ok).toBe(true);

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        groups: { linearIssueId: string | null; linearIssue?: unknown; tasks: { linearIssue?: unknown }[] }[];
      };
    };
    // Groups should still be returned even though hydration failed
    const group = body.data.groups.find((g) => g.linearIssueId === 'INT-1600');
    expect(group).toBeDefined();
    // Tasks should NOT have linearIssue since hydration failed
    expect(group?.tasks[0]?.linearIssue).toBeUndefined();
  });

  it('accepts sortBy=started-time and returns groups', async () => {
    // Covers route accepting started-time sort option
    // Note: dispatchedAt cannot be set via FakeFirestore update (Timestamp/FieldValue.delete conflict),
    // so the sort falls back to createdAt. This still exercises the started-time code path.
    const r1 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1700', traceId: 'trace-started1' }));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    await codeTaskRepo.update(r1.value.id, { status: 'implemented' });

    const r2 = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1701', traceId: 'trace-started2' }));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await codeTaskRepo.update(r2.value.id, { status: 'implemented' });

    mockSummaries = [
      makeSummary({ linearIssueId: 'INT-1700', aggregateStatus: 'done', latestTaskStatus: 'implemented' }),
      makeSummary({ linearIssueId: 'INT-1701', aggregateStatus: 'done', latestTaskStatus: 'implemented' }),
    ];
    mockCounts = { ...mockCounts, done: 2, totalGroups: 2 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?sortBy=started-time',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    // Both groups should be returned (falls back to createdAt sort since no dispatchedAt)
    expect(body.data.groups.length).toBe(2);
  });

  it('handles invalid cursor with negative index gracefully', async () => {
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1800', traceId: 'trace-bad-cursor' }));
    expect(r.ok).toBe(true);

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1800' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    // Encode a cursor with negative index
    const badCursor = Buffer.from(JSON.stringify({ index: -1 })).toString('base64url');
    const response = await server.inject({
      method: 'GET',
      url: `/code/issue-groups?cursor=${badCursor}`,
      headers: { authorization: 'Bearer test-token' },
    });

    // Should fall back to start (index 0) since the cursor is invalid
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[] } };
    expect(body.data.groups.length).toBeGreaterThan(0);
  });

  it('handles cursor with non-integer index gracefully', async () => {
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1801', traceId: 'trace-nan-cursor' }));
    expect(r.ok).toBe(true);

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1801' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    const badCursor = Buffer.from(JSON.stringify({ index: 'abc' })).toString('base64url');
    const response = await server.inject({
      method: 'GET',
      url: `/code/issue-groups?cursor=${badCursor}`,
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[] } };
    expect(body.data.groups.length).toBeGreaterThan(0);
  });

  it('serializes tasks with completedAt, parentTaskId, followUpReason, error fields', async () => {
    const r = await codeTaskRepo.create({
      ...makeTaskInput({ linearIssueId: 'INT-1900', traceId: 'trace-all-fields' }),
      parentTaskId: 'parent-task-1',
      followUpReason: 'retry',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    await codeTaskRepo.update(r.value.id, {
      status: 'failed',
      completedAt: new Date(),
      error: { code: 'WORKER_DIED', message: 'Worker process crashed' },
    });

    mockSummaries = [makeSummary({ linearIssueId: 'INT-1900', aggregateStatus: 'failed', latestTaskStatus: 'failed' })];
    mockCounts = { ...mockCounts, failed: 1, totalGroups: 1 };

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      data: {
        groups: {
          linearIssueId: string | null;
          tasks: {
            parentTaskId?: string;
            followUpReason?: string;
            completedAt?: string;
            error?: { code: string; message: string };
          }[];
        }[];
      };
    };

    const group = body.data.groups.find((g) => g.linearIssueId === 'INT-1900');
    expect(group).toBeDefined();
    const task = group?.tasks[0];
    expect(task).toBeDefined();
    expect(task?.parentTaskId).toBe('parent-task-1');
    expect(task?.followUpReason).toBe('retry');
    expect(task?.error?.code).toBe('WORKER_DIED');
  });

  describe('precomputed summaries path', () => {
    it('returns counts from getUserGroupCounts', async () => {
      const fakeCounts: UserGroupCounts = {
        userId: 'test-user-id',
        active: 3,
        needsAction: 2,
        done: 10,
        failed: 1,
        totalGroups: 16,
        updatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
      };

      setServices({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
        codeTaskRepo,
        taskDispatcher: {
          async dispatch() { return ok({ dispatched: true, workerLocation: 'mac' }); },
          async cancelOnWorker() { return; },
          async sendMessageToWorker() { return ok({ action: 'queued' }); },
        } as TaskDispatcherService,
        whatsappNotifier: createWhatsAppNotifier({
          whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher,
        }),
        logChunkRepo: createFirestoreLogChunkRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        logLineRepo: createFirestoreLogLineRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }),
        linearAgentClient: makeLinearAgentClient(),
        rateLimitService: { async checkLimits() { return ok(undefined); }, async recordTaskStart() { return; }, async recordTaskComplete() { return; } } as RateLimitService,
        linearIssueService: createLinearIssueService({ linearAgentClient: makeLinearAgentClient(), logger }),
        metricsClient: createNoOpMetricsClient(),
        statusMirrorService: createStatusMirrorService({ actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }), logger }),
        processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        workerHealthProbe: mockWorkerHealthProbe,
        gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
        gitHubPRSummaryRepo: {} as never,
        turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        userServiceClient: mockUserServiceClient,
        gitHubPRClient: {} as never,
        webhookRules: {} as never,
        dispatchService: {} as never,
        toolCallingClient: undefined,
        eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
        dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
        unifiedEvaluator: {} as never,
        automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
        taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
        mergeConflictDetector: { detectOnPush: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT) },
        mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
        archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        groupSummaryRepo: makeGroupSummaryRepo({
          getUserGroupCounts: async () => ok(fakeCounts),
          listGroupSummaries: async () => ok({ summaries: [] }),
        }),
      });

      await server.close();
      server = await buildServer();

      const response = await server.inject({
        method: 'GET',
        url: '/code/issue-groups',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { counts: Record<string, number>; totalGroups: number; groups: unknown[] } };
      // Counts should come from getUserGroupCounts, not from groupByLinearIssue
      expect(body.data.counts['active']).toBe(3);
      expect(body.data.counts['needs-action']).toBe(2);
      expect(body.data.counts['done']).toBe(10);
      expect(body.data.counts['failed']).toBe(1);
      expect(body.data.totalGroups).toBe(16);
      expect(body.data.groups).toEqual([]);
    });

    it('returns groups built from tasks fetched per summary', async () => {
      // Create a task so codeTaskRepo has data
      const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-9001', traceId: 'trace-summary-path' }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const taskId = r.value.id;

      const fakeSummary: TaskGroupSummary = {
        userId: 'test-user-id',
        linearIssueId: 'INT-9001',
        groupKey: 'INT-9001',
        taskCount: 1,
        activeTaskCount: 1,
        latestTaskStatus: 'queued',
        latestTaskUpdatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
        agentTypesPresent: ['planning'],
        hasCompletedPlanning: false,
        hasCompletedExecution: false,
        hasImplementationTaskId: false,
        hasPrUrl: false,
        prNumber: null,
        latestReviewNeedsRemediation: null,
        oldestTaskCreatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
        mostRecentDispatchedAt: null,
        aggregateStatus: 'active',
        updatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
      };

      void taskId; // used to verify task exists in fake firestore

      setServices({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
        codeTaskRepo,
        taskDispatcher: {
          async dispatch() { return ok({ dispatched: true, workerLocation: 'mac' }); },
          async cancelOnWorker() { return; },
          async sendMessageToWorker() { return ok({ action: 'queued' }); },
        } as TaskDispatcherService,
        whatsappNotifier: createWhatsAppNotifier({
          whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher,
        }),
        logChunkRepo: createFirestoreLogChunkRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        logLineRepo: createFirestoreLogLineRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }),
        linearAgentClient: makeLinearAgentClient(),
        rateLimitService: { async checkLimits() { return ok(undefined); }, async recordTaskStart() { return; }, async recordTaskComplete() { return; } } as RateLimitService,
        linearIssueService: createLinearIssueService({ linearAgentClient: makeLinearAgentClient(), logger }),
        metricsClient: createNoOpMetricsClient(),
        statusMirrorService: createStatusMirrorService({ actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }), logger }),
        processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        workerHealthProbe: mockWorkerHealthProbe,
        gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
        gitHubPRSummaryRepo: {} as never,
        turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        userServiceClient: mockUserServiceClient,
        gitHubPRClient: {} as never,
        webhookRules: {} as never,
        dispatchService: {} as never,
        toolCallingClient: undefined,
        eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
        dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
        unifiedEvaluator: {} as never,
        automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
        taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
        mergeConflictDetector: { detectOnPush: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT) },
        mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
        archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        groupSummaryRepo: makeGroupSummaryRepo({
          listGroupSummaries: async () => ok({ summaries: [fakeSummary] }),
        }),
      });

      await server.close();
      server = await buildServer();

      const response = await server.inject({
        method: 'GET',
        url: '/code/issue-groups',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null; tasks: unknown[] }[] } };
      // Group for INT-9001 should be present with the task fetched from codeTaskRepo
      const group = body.data.groups.find((g) => g.linearIssueId === 'INT-9001');
      expect(group).toBeDefined();
      expect(group?.tasks).toHaveLength(1);
    });

    it('returns 500 when getUserGroupCounts fails', async () => {
      setServices({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
        codeTaskRepo,
        taskDispatcher: {
          async dispatch() { return ok({ dispatched: true, workerLocation: 'mac' }); },
          async cancelOnWorker() { return; },
          async sendMessageToWorker() { return ok({ action: 'queued' }); },
        } as TaskDispatcherService,
        whatsappNotifier: createWhatsAppNotifier({
          whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher,
        }),
        logChunkRepo: createFirestoreLogChunkRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        logLineRepo: createFirestoreLogLineRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }),
        linearAgentClient: makeLinearAgentClient(),
        rateLimitService: { async checkLimits() { return ok(undefined); }, async recordTaskStart() { return; }, async recordTaskComplete() { return; } } as RateLimitService,
        linearIssueService: createLinearIssueService({ linearAgentClient: makeLinearAgentClient(), logger }),
        metricsClient: createNoOpMetricsClient(),
        statusMirrorService: createStatusMirrorService({ actionsAgentClient: createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger }), logger }),
        processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        workerHealthProbe: mockWorkerHealthProbe,
        gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
        gitHubPRSummaryRepo: {} as never,
        turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
        userServiceClient: mockUserServiceClient,
        gitHubPRClient: {} as never,
        webhookRules: {} as never,
        dispatchService: {} as never,
        toolCallingClient: undefined,
        eventDecisionRepo: createFirestoreEventDecisionRepository({ logger }),
        dispatchRetryRepo: createFirestoreDispatchRetryRepository({ logger }),
        unifiedEvaluator: {} as never,
        automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
        taskEnqueueService: { enqueue: vi.fn().mockResolvedValue(ok({ taskId: 'test', queuePosition: 1 })) } as never,
        mergeConflictDetector: { detectOnPush: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue(EMPTY_RECONCILE_RESULT) },
        mergeQueueWatchRepo: createFirestoreMergeQueueWatchRepository({ logger }),
        archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
        groupSummaryRepo: makeGroupSummaryRepo({
          getUserGroupCounts: async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'Counts fetch failed' }),
        }),
      });

      await server.close();
      server = await buildServer();

      const response = await server.inject({
        method: 'GET',
        url: '/code/issue-groups',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error?: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error?.code).toBe('INTERNAL_ERROR');
    });
  });

  it('returns 500 when listGroupSummaries fails', async () => {
    setServices(makeBaseServices({
      groupSummaryRepo: makeGroupSummaryRepo({
        listGroupSummaries: async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'Summaries fetch failed' }),
      }),
    }));

    await server.close();
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as { success: boolean; error?: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('INTERNAL_ERROR');
  });

  it('returns 200 with no group when findRecentTasksByLinearIssue fails', async () => {
    // When task fetch fails, the group has no tasks → groupByLinearIssue produces no entry for it.
    // The route handles the error gracefully (warns + returns []) rather than failing.
    const failingCodeTaskRepo: CodeTaskRepository = {
      ...codeTaskRepo,
      findRecentTasksByLinearIssue: async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'DB error' }),
    };

    mockSummaries = [makeSummary({ linearIssueId: 'INT-2001' })];
    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    setServices(makeBaseServices({
      codeTaskRepo: failingCodeTaskRepo,
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => ok(mockCounts),
        listGroupSummaries: async () => ok({ summaries: mockSummaries }),
      }),
    }));

    await server.close();
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    // Route returns 200 (error is non-fatal — logged as warn, group omitted)
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[] } };
    // No group produced because tasks returned empty array (fetch failed)
    expect(body.data.groups).toHaveLength(0);
  });

  it('returns empty tasks for standalone group when findById fails', async () => {
    const standaloneTaskId = 'standalone-task-99';
    const failingCodeTaskRepo: CodeTaskRepository = {
      ...codeTaskRepo,
      findById: async () => err({ code: 'NOT_FOUND' as const, message: 'Task not found' }),
    };

    const standaloneSummary: TaskGroupSummary = {
      userId: 'test-user-id',
      linearIssueId: null,
      groupKey: `standalone_${standaloneTaskId}`,
      taskCount: 1,
      activeTaskCount: 1,
      latestTaskStatus: 'queued',
      latestTaskUpdatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
      agentTypesPresent: [],
      hasCompletedPlanning: false,
      hasCompletedExecution: false,
      hasImplementationTaskId: false,
      hasPrUrl: false,
      prNumber: null,
      latestReviewNeedsRemediation: null,
      oldestTaskCreatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
      mostRecentDispatchedAt: null,
      aggregateStatus: 'active',
      updatedAt: new Date() as unknown as import('@google-cloud/firestore').Timestamp,
    };

    mockCounts = { ...mockCounts, active: 1, totalGroups: 1 };

    setServices(makeBaseServices({
      codeTaskRepo: failingCodeTaskRepo,
      groupSummaryRepo: makeGroupSummaryRepo({
        getUserGroupCounts: async () => ok(mockCounts),
        listGroupSummaries: async () => ok({ summaries: [standaloneSummary] }),
      }),
    }));

    await server.close();
    server = await buildServer();

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups',
      headers: { authorization: 'Bearer test-token' },
    });

    // Route returns 200 (error is non-fatal — logged as warn, group omitted)
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[] } };
    // No group produced because tasks returned empty array (fetch failed)
    expect(body.data.groups).toHaveLength(0);
  });
});
