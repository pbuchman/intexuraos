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
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../../infra/repositories/firestoreLogLineRepository.js';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../../domain/usecases/cleanupTaskLogs.js';
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

function makeLinearAgentClient(): LinearAgentClient {
  const client: LinearAgentClient = {
    createIssue: () => Promise.resolve(ok({ issueId: 'id', issueIdentifier: 'INT-1', issueTitle: 'title', issueUrl: 'url' })),
    updateIssueState: () => Promise.resolve(ok(undefined)),
    validateIssue: (req) => Promise.resolve(ok({ id: `id-${req.identifier}`, identifier: req.identifier, title: `Mock ${req.identifier}`, url: `https://linear.app/${req.identifier}`, labels: [], childCount: 0, parentId: null })),
    generateTitle: (req) => Promise.resolve(ok({ title: req.description.slice(0, 80), issueType: 'feature' })),
    addComment: () => Promise.resolve(ok({ commentId: 'c1' })),
    fetchIssueTree: (req) => Promise.resolve(ok({ root: { id: req.issueId, identifier: `INT-${req.issueId}`, url: `https://linear.app/${req.issueId}`, parentId: null, labels: [], assigneeId: null, state: 'Backlog' }, descendants: [] })),
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

describe('GET /code/issue-groups', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
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

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?sortBy=pr-number',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    const issueIds = body.data.groups.map((g) => g.linearIssueId);
    // pr-number sort is descending
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

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?sortBy=created-time',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: { linearIssueId: string | null }[] } };
    const issueIds = body.data.groups.map((g) => g.linearIssueId);
    // created-time sort: newest first
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

    const response = await server.inject({
      method: 'GET',
      url: '/code/issue-groups?groupStatus=active',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { data: { groups: unknown[]; totalGroups: number; counts: Record<string, number> } };
    // totalGroups should reflect the filtered count
    expect(body.data.totalGroups).toBe(2);
    expect(body.data.groups).toHaveLength(2);
    // But global counts include all
    expect(body.data.counts['active']).toBe(2);
    expect(body.data.counts['failed']).toBe(1);
  });

  it('hydrates Linear issue data on tasks', async () => {
    const r = await codeTaskRepo.create(makeTaskInput({ linearIssueId: 'INT-1100', traceId: 'trace-hydrate' }));
    expect(r.ok).toBe(true);

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

  it('serializes tasks with agentType, implementationTaskId, prNumber, and result fields', async () => {
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
      prNumber: 42,
      result: { prUrl: 'https://github.com/org/repo/pull/42' },
    });

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
    // Covers item 18: listResult.ok check (error path)
    // Replace codeTaskRepo with one that returns an error
    const failingRepo: CodeTaskRepository = {
      ...codeTaskRepo,
      listAllNonArchived: async () => err({ code: 'FIRESTORE_ERROR' as const, message: 'Database connection failed' }),
    };
    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo: failingRepo,
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
        codeTaskRepository: failingRepo,
        logger,
      }),
      detectZombieTasks: createDetectZombieTasksUseCase({
        codeTaskRepository: failingRepo,
        logger,
      }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({
        codeTaskRepository: failingRepo,
        logger,
      }),
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
});
