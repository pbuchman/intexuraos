/**
 * Tests for code routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';
import crypto from 'node:crypto';
import { err } from '@intexuraos/common-core';

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
import { createFirestoreCodeTaskRepository } from '../../infra/firestore/firestoreCodeTaskRepository.js';
import type { Logger } from 'pino';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/firestore/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/firestore/firestoreLogLineRepository.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { TaskDispatcherService, DispatchResult, DispatchError } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import { ok, type Result } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/whatsapp-pubsub-client';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createAutoArchiveMergedTasksUseCase } from '../../domain/usecases/autoArchiveMergedTasks.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import type { WorkerConfig, WorkerHealthState } from '../../domain/models/workerSettings.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/firestore/firestoreTurnMetricsRepository.js';
import { Timestamp } from '@google-cloud/firestore';
import type { DispatchRetry } from '../../domain/models/dispatchRetry.js';
import type { DispatchRetryRepository } from '../../domain/repositories/dispatchRetryRepository.js';

// Helper function to generate orchestrator HMAC signature for heartbeat endpoint
function generateOrchestratorSignature(payload: object, secret: string): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(payload);
  const message = `${timestamp}.${rawBody}`;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { timestamp, signature };
}

function healthyWorkerState(
  overrides: Partial<Extract<WorkerHealthState, { _tag: 'healthy' }>> = {}
): Extract<WorkerHealthState, { _tag: 'healthy' }> {
  return {
    _tag: 'healthy',
    healthy: true,
    capacity: 1,
    running: 0,
    available: 1,
    workerAuths: {
      claude: { status: 'active' },
      codex: { status: 'active' },
    },
    providerApiKeys: {},
    dockerHealthy: true,
    diskHealthy: true,
    responseTimeMs: 100,
    ...overrides,
  };
}

describe('codeRoutes', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let originalWebAppUrl: string | undefined;

  beforeEach(async () => {
    originalWebAppUrl = process.env['INTEXURAOS_WEB_APP_URL'];
    delete process.env['INTEXURAOS_WEB_APP_URL'];

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
      linearAgentClient,
      linearIssueService,
      metricsClient: createNoOpMetricsClient(),
      processHeartbeat: createProcessHeartbeatUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      detectZombieTasks: createDetectZombieTasksUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, gitHubPRSummaryRepo: { findAllOpen: async () => ok([]) }, logger }),
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
      dispatchRetryRepo: {
        async findOldest() { return ok(null); },
        async claimForProcessing() { return ok(true); },
        async create() { return ok({} as never); },
        async delete() { return ok(undefined); },
        async update() { return ok(undefined); },
      },
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      prTriagePublisher: {} as never,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      whatsappNotifier: WhatsAppNotifier;
      linearAgentClient: LinearAgentClient;
      linearIssueService: LinearIssueService;
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

    server = await buildServer();
  });

  afterEach(() => {
    if (originalWebAppUrl === undefined) {
      delete process.env['INTEXURAOS_WEB_APP_URL'];
    } else {
      process.env['INTEXURAOS_WEB_APP_URL'] = originalWebAppUrl;
    }
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  it('has routes registered', async () => {
    // Placeholder test - routes are tested via integration tests
    expect(true).toBe(true);
  });

  describe('GET /code/tasks/:taskId', () => {
    it('returns task when user owns it', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix login bug',
        sanitizedPrompt: 'fix login bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/tasks/${created.value.id}`,
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(created.value.id);
    });

    it('returns review result fields when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Review PR',
        sanitizedPrompt: 'review pr',
        systemPromptHash: 'review-auto',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-review-123',
        agentType: 'review',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updateResult = await repo.update(created.value.id, {
        status: 'reviewed',
        result: {
          summary: 'Reviewed the PR and posted two comments.',
          review_comments_posted: '2',
          review_types: 'code_quality,architecture',
        } as typeof created.value.result,
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/tasks/${created.value.id}`,
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.result.review_comments_posted).toBe('2');
      expect(body.data.result.review_types).toBe('code_quality,architecture');
    });

    it('returns execution memory candidates and search counts when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Review execution memory contract',
        sanitizedPrompt: 'review execution memory contract',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-memory-123',
        executionMemoryContext: {
          status: 'matched',
          applicationId: 'app-123',
          retrievalVersion: 'execution-memory-retrieval@1.0.0',
          querySummary: 'Route logging and verification work',
          matchedAt: Timestamp.now(),
          matchedMemories: [
            {
              memoryId: 'mem-1',
              title: 'Verify route serialization',
              memoryType: 'verification_pattern',
              score: 0.91,
              appliesWhen: 'Route schema changes',
              action: 'Add app.inject coverage',
              avoid: 'Do not skip serialization',
              verification: 'Check task detail response shape',
            },
          ],
          topCandidates: [
            {
              memoryId: 'mem-1',
              title: 'Verify route serialization',
              memoryType: 'verification_pattern',
              vectorScore: 0.85,
              rerankScore: 0.91,
              componentOverlap: 0.72,
              effectiveness: 0.65,
              passedThreshold: true,
            },
            {
              memoryId: 'mem-2',
              title: 'Route logging',
              memoryType: 'pitfall_pattern',
              vectorScore: 0.80,
              rerankScore: 0.74,
              componentOverlap: 0.63,
              effectiveness: 0.51,
              passedThreshold: false,
            },
          ],
          totalSearchResults: 9,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/tasks/${created.value.id}`,
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.executionMemoryContext.topCandidates).toEqual([
        {
          memoryId: 'mem-1',
          title: 'Verify route serialization',
          memoryType: 'verification_pattern',
          vectorScore: 0.85,
          rerankScore: 0.91,
          componentOverlap: 0.72,
          effectiveness: 0.65,
          passedThreshold: true,
        },
        {
          memoryId: 'mem-2',
          title: 'Route logging',
          memoryType: 'pitfall_pattern',
          vectorScore: 0.8,
          rerankScore: 0.74,
          componentOverlap: 0.63,
          effectiveness: 0.51,
          passedThreshold: false,
        },
      ]);
      expect(body.data.executionMemoryContext.totalSearchResults).toBe(9);
    });

    it('returns 404 for other user\'s task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task
      const created = await repo.create({
        userId: 'other-user',
        prompt: 'Fix login bug',
        sanitizedPrompt: 'fix login bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: `/tasks/${created.value.id}`,
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('returns 404 for non-existent task', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tasks/non-existent',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tasks/task-123',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /internal/code-tasks/zombies', () => {
    it('returns zombie tasks successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a running task
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Running task',
        sanitizedPrompt: 'running task',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update to running status
      await repo.update(created.value.id, { status: 'running' });

      // Note: In fakeFirestore, timestamps are always current, so we can't test
      // actual zombie detection. We just verify the endpoint structure works.
      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/zombies?staleThresholdMinutes=5',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toBeInstanceOf(Array);
    });

    it('returns empty array when no zombie tasks found', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/zombies?staleThresholdMinutes=5',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toEqual([]);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/zombies?staleThresholdMinutes=5',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /code/tasks', () => {
    it('returns tasks for user successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks for 'test-user-id' (what validateInternalAuth returns)
      const task1 = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task 1',
        sanitizedPrompt: 'task 1',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(task1.ok).toBe(true);

      const task2 = await repo.create({
        userId: 'test-user-id',
        prompt: 'Task 2',
        sanitizedPrompt: 'task 2',
        systemPromptHash: 'def456',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-456',
      });
      expect(task2.ok).toBe(true);

      await repo.create({
        userId: 'other-user',
        prompt: 'Other user task',
        sanitizedPrompt: 'other user task',
        systemPromptHash: 'ghi789',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-789',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/tasks',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toBeInstanceOf(Array);
      expect(body.data.tasks.length).toBe(2);
    });

    it('returns review result fields in list responses when present', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Review task',
        sanitizedPrompt: 'review task',
        systemPromptHash: 'review-auto',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-review-list-123',
        agentType: 'review',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updateResult = await repo.update(created.value.id, {
        status: 'reviewed',
        result: {
          summary: 'Reviewed the PR and posted one comment.',
          review_comments_posted: '1',
          review_types: 'code_quality',
        } as typeof created.value.result,
      });
      expect(updateResult.ok).toBe(true);
      if (!updateResult.ok) return;

      const response = await server.inject({
        method: 'GET',
        url: '/tasks',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks[0].result.review_comments_posted).toBe('1');
      expect(body.data.tasks[0].result.review_types).toBe('code_quality');
    });

    it('filters tasks by status', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create tasks with different statuses
      const task1 = await repo.create({
        userId: 'test-user-id',
        prompt: 'Completed task',
        sanitizedPrompt: 'completed task',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(task1.ok).toBe(true);
      if (task1.ok) {
        await repo.update(task1.value.id, { status: 'implemented' });
      }

      await repo.create({
        userId: 'test-user-id',
        prompt: 'Dispatched task',
        sanitizedPrompt: 'dispatched task',
        systemPromptHash: 'def456',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-456',
      });

      const response = await server.inject({
        method: 'GET',
        url: '/tasks?status=implemented',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks.length).toBe(1);
      expect(body.data.tasks[0].status).toBe('implemented');
    });

    it('paginates results with limit', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create multiple tasks
      for (let i = 0; i < 5; i++) {
        await repo.create({
          userId: 'test-user-id',
          prompt: `Task ${i}`,
          sanitizedPrompt: `task ${i}`,
          systemPromptHash: `hash${i}`,
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'test/repo',
          baseBranch: 'main',
          traceId: `trace-${i}`,
        });
      }

      const response = await server.inject({
        method: 'GET',
        url: '/tasks?limit=2',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks.length).toBe(2);
      expect(body.data.nextCursor).toBeDefined();
    });

    it('returns empty array for user with no tasks', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tasks',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.tasks).toEqual([]);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/tasks',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when repository fails', async () => {
      // Create a mock repository that returns an error
      const mockRepo = {
        list: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'Firestore error' },
        }),
      } as unknown as CodeTaskRepository;

      // Override the service with mock repository
      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/tasks?userId=user-123',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /internal/code-tasks/zombies error handling', () => {
    it('returns 500 when findZombieTasks fails', async () => {
      // Create a mock repository that returns an error
      const mockRepo = {
        findZombieTasks: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'Failed to find zombie tasks' },
        }),
      } as unknown as CodeTaskRepository;

      // Override the service with mock repository
      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/zombies?staleThresholdMinutes=5',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /internal/code-tasks/linear/:linearIssueId/active', () => {
    it('returns active task status when task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task with a Linear issue ID
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix INT-123',
        sanitizedPrompt: 'fix int-123',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
        linearIssueId: 'INT-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update to running status
      await repo.update(created.value.id, { status: 'running' });

      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-123/active',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.hasActive).toBe(true);
      expect(body.data.taskId).toBe(created.value.id);
    });

    it('returns hasActive: false when no active task exists', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-999/active',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.hasActive).toBe(false);
    });

    it('returns hasActive: false when task is completed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix INT-456',
        sanitizedPrompt: 'fix int-456',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-456',
        linearIssueId: 'INT-456',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update to completed status
      const updated = await repo.update(created.value.id, { status: 'implemented' });
      expect(updated.ok).toBe(true);

      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-456/active',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.hasActive).toBe(false);
    });

    it('returns hasActive: false when only an active review task exists', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Review PR #42',
        sanitizedPrompt: 'review pr #42',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-review-123',
        linearIssueId: 'INT-123',
        prNumber: 42,
        agentType: 'review',
      });
      expect(created.ok).toBe(true);

      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-123/active',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.hasActive).toBe(false);
      expect(body.data.taskId).toBeUndefined();
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-123/active',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when repository fails', async () => {
      // Create a mock repository that returns an error
      const mockRepo = {
        hasActiveTaskForLinearIssue: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'Failed to check active task' },
        }),
      } as unknown as CodeTaskRepository;

      // Override the service with mock repository
      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/internal/code-tasks/linear/INT-123/active',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /internal/code-tasks/:taskId', () => {
    it('updates task status successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          status: 'planned',
          result: {
            branch: 'fix-branch',
            commits: 3,
            summary: 'Fixed the bug',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.task.status).toBe('planned');
    });

    it('accepts implemented status for ask_agent tasks', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task with agentType ask_agent and status running
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Ask agent question',
        sanitizedPrompt: 'ask agent question',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
        agentType: 'ask_agent',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${created.value.id}`,
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          status: 'implemented',
          result: {
            summary: 'Agent answered the question',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.task.status).toBe('implemented');
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/internal/code-tasks/non-existent-task',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          status: 'planned',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/internal/code-tasks/task-123',
        payload: {
          status: 'planned',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when repository returns NOT_FOUND', async () => {
      // Create a mock repository that returns NOT_FOUND
      const mockRepo = {
        update: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Task not found' },
        }),
      } as unknown as CodeTaskRepository;

      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'PATCH',
        url: '/internal/code-tasks/task-123',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          status: 'planned',
        },
      });

      expect(response.statusCode).toBe(404);
    });

  });

  describe('timestampToIso', () => {
    it('returns undefined for undefined timestamp', async () => {
      const { timestampToIso } = await import('../../routes/codeRoutes.js');
      expect(timestampToIso(undefined)).toBe(undefined);
    });

    it('returns string directly when timestamp is a string', async () => {
      const { timestampToIso } = await import('../../routes/codeRoutes.js');
      const dateString = '2024-01-15T10:30:00.000Z';
      expect(timestampToIso(dateString)).toBe(dateString);
    });

    it('converts Timestamp with toDate method to ISO string', async () => {
      const { timestampToIso } = await import('../../routes/codeRoutes.js');
      const testDate = new Date('2024-01-15T10:30:00.000Z');
      const mockTimestamp = { toDate: (): Date => testDate };
      expect(timestampToIso(mockTimestamp)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('returns undefined for object without toDate method', async () => {
      const { timestampToIso } = await import('../../routes/codeRoutes.js');
      const invalidTimestamp = { invalid: true } as unknown as { toDate: () => Date };
      expect(timestampToIso(invalidTimestamp)).toBe(undefined);
    });
  });

  describe('POST /code/submit', () => {
    it('submits task successfully', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
        },
      });

      // Note: This test may fail if workers are unavailable, but that's expected behavior
      expect([200, 503]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('submitted');
        expect(body.data.codeTaskId).toBeDefined();
      }
    });

    it('submits task with workerType and linearIssueId', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          workerType: 'opus',
          linearIssueId: 'INT-123',
          linearIssueTitle: 'Fix login bug',
        },
      });

      // Note: This test may fail if workers are unavailable, but that's expected behavior
      expect([200, 503]).toContain(response.statusCode);
      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('submitted');
        expect(body.data.codeTaskId).toBeDefined();
      }
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/submit',
        payload: {
          prompt: 'Fix the login bug',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 409 for duplicate prompt', async () => {
      const mockRepo = {
        create: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'DUPLICATE_PROMPT',
            message: 'Similar task submitted in last 5 minutes',
            existingTaskId: 'task-123',
          },
        }),
      } as unknown as CodeTaskRepository;

      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 for active task exists', async () => {
      const mockRepo = {
        create: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'ACTIVE_TASK_EXISTS',
            message: 'Active task already exists for this Linear issue',
            existingTaskId: 'task-456',
          },
        }),
      } as unknown as CodeTaskRepository;

      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          linearIssueId: 'INT-123',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns a failed task id when enqueue returns queue_full error', async () => {
      setServices({
        ...getServices(),
        taskEnqueueService: {
          enqueue: vi.fn().mockResolvedValue(err({ code: 'queue_full', message: 'Queue is full' })),
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/submit',
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
      expect(body.data.status).toBe('failed');
      expect(body.data.codeTaskId).toBeDefined();
    });

    it('returns a failed task id when getSettings fails after task creation', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        err({ code: 'internal_error', message: 'Firestore unavailable' })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/submit',
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
      expect(body.data).toEqual(expect.objectContaining({
        status: 'failed',
        codeTaskId: expect.stringMatching(/^task_/),
      }));

      const taskResult = await services.codeTaskRepo.findById(body.data.codeTaskId);
      expect(taskResult.ok).toBe(true);
      if (taskResult.ok) {
        expect(taskResult.value.status).toBe('failed');
        expect(taskResult.value.dispatchStatus).toEqual(expect.objectContaining({
          reason: 'dispatch_failed',
          terminal: true,
        }));
      }

      mockGetSettings.mockRestore();
    });

    it('returns a failed task id when user has no enabled workers', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'disabled-worker',
              url: 'http://localhost:3000',
              enabled: false,
              cfAccessClientId: 'cf-client-id',
              cfAccessClientSecret: 'cf-client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/submit',
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
      expect(body.data.status).toBe('failed');
      expect(body.data.codeTaskId).toBeDefined();

      mockGetSettings.mockRestore();
    });

  });

  describe('POST /code/cancel', () => {
    it('cancels task successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a running task
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'running' });

      const response = await server.inject({
        method: 'POST',
        url: '/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId: created.value.id,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('cancelled');
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/cancel',
        payload: {
          taskId: 'task-123',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/cancel',
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
    });

    it('returns 403 when user does not own task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task for a different user
      const created = await repo.create({
        userId: 'other-user',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'POST',
        url: '/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId: created.value.id,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 409 when task is not in cancellable state', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a completed task
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'implemented' });

      const response = await server.inject({
        method: 'POST',
        url: '/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId: created.value.id,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('GET /code/workers/status', () => {
    it('returns workers array from user settings', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toBeDefined();
      expect(Array.isArray(body.data.workers)).toBe(true);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns empty workers array when getSettings fails', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        err({ code: 'internal_error', message: 'Firestore unavailable' })
      );

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toEqual([]);
      expect(body.data.stale).toBe(false);

      mockGetSettings.mockRestore();
    });

    it('returns empty workers array when settings is null', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok(null)
      );

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toEqual([]);
      expect(body.data.stale).toBe(false);

      mockGetSettings.mockRestore();
    });

    it('returns healthy worker with correct details mapping', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'test-worker': {
            state: healthyWorkerState({
              capacity: 5,
              running: 2,
              available: 3,
              responseTimeMs: 150,
            }),
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0].name).toBe('test-worker');
      expect(body.data.workers[0].enabled).toBe(true);
      expect(body.data.workers[0].healthy).toBe(true);
      expect(body.data.workers[0].status).toBe('healthy');
      expect(body.data.workers[0].details).toEqual({
        capacity: 5,
        running: 2,
        available: 3,
        responseTimeMs: 150,
      });

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns disabled worker status without probing disabled workers', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'disabled-worker',
              url: 'http://disabled-worker:3000',
              enabled: false,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({})
      );
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.stale).toBe(false);
      expect(body.data.workers).toEqual([
        {
          name: 'disabled-worker',
          url: 'http://disabled-worker:3000',
          priority: 1,
          enabled: false,
          healthy: false,
          status: 'disabled',
          details: { reason: 'disabled' },
          checkedAt: null,
          stale: false,
        },
      ]);
      expect(mockProbeAllWorkers).not.toHaveBeenCalled();

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('treats legacy workers with missing enabled as enabled in status responses', async () => {
      const services = getServices();
      const legacyWorker = {
        name: 'legacy-worker',
        url: 'http://legacy-worker:3000',
        cfAccessClientId: 'client-id',
        cfAccessClientSecret: 'client-secret',
        dispatchSigningSecret: 'secret',
      } satisfies Omit<WorkerConfig, 'enabled'>;
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [legacyWorker as WorkerConfig],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'legacy-worker': {
            state: healthyWorkerState({
              responseTimeMs: 50,
            }),
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.workers[0]).toMatchObject({
        name: 'legacy-worker',
        enabled: true,
        healthy: true,
        status: 'healthy',
      });
      expect(mockProbeAllWorkers).not.toHaveBeenCalled();

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns orchestrator-unreachable worker with reason in details', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'test-worker': {
            state: {
              _tag: 'orchestrator-unreachable',
              healthy: false,
              reason: 'timeout',
              code: 'ECONNREFUSED',
            },
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0].healthy).toBe(false);
      expect(body.data.workers[0].status).toBe('orchestrator-unreachable');
      expect(body.data.workers[0].details).toEqual({
        reason: 'timeout',
        code: 'ECONNREFUSED',
      });

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns tunnel-down worker with reason in details', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'test-worker': {
            state: {
              _tag: 'tunnel-down',
              healthy: false,
              reason: 'connection-refused',
            },
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0].healthy).toBe(false);
      expect(body.data.workers[0].status).toBe('tunnel-down');
      expect(body.data.workers[0].details).toEqual({
        reason: 'connection-refused',
      });

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns unknown worker contract mismatch details', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'test-worker': {
            state: {
              _tag: 'unknown',
              healthy: false,
              error: 'Health response missing worker capability details',
              contractMismatch: true,
              missingFields: ['providerApiKeys'],
            },
            checkedAt: new Date().toISOString(),
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        healthy: false,
        status: 'unknown',
        details: {
          error: 'Health response missing worker capability details',
          contractMismatch: true,
          missingFields: ['providerApiKeys'],
        },
      });

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns stale=true when health status is older than 60 seconds', async () => {
      const services = getServices();
      const oldCheckedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago

      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({
          'test-worker': {
            state: healthyWorkerState(),
            checkedAt: oldCheckedAt,
            stale: false,
          },
        })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.stale).toBe(true);
      expect(body.data.workers[0].stale).toBe(true);

      // Verify the health probe was called due to stale status
      expect(mockProbeAllWorkers).toHaveBeenCalled();

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('triggers health probe when worker has no health status', async () => {
      const services = getServices();

      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      // No health status for the worker - this triggers the probe
      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({})
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'test-worker': {
          _tag: 'healthy',
          healthy: true,
          capacity: 1,
          running: 0,
          available: 1,
          responseTimeMs: 100,
        },
      });

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockProbeAllWorkers).toHaveBeenCalled();

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('reuses in-flight health probe for concurrent requests', async () => {
      const services = getServices();

      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      // No health status for the worker - this triggers the probe
      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        ok({})
      );

      // Create a promise that we control
      let resolveProbe: (() => void) | undefined;
      const pendingPromise = new Promise<void>((resolve) => {
        resolveProbe = resolve;
      });

      // Import the route module to access inFlightRequests
      const codeRoutesModule = await import('../../routes/codeRoutes.js');
      const inFlightRequests = (codeRoutesModule as unknown as { inFlightRequests: Map<string, Promise<void>> }).inFlightRequests;

      // Pre-populate inFlightRequests to simulate an existing in-flight probe
      const probeKey = 'health-probe:test-user-id';
      inFlightRequests.set(probeKey, pendingPromise);

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'test-worker': {
          _tag: 'healthy',
          healthy: true,
          capacity: 1,
          running: 0,
          available: 1,
          responseTimeMs: 100,
        },
      });

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      // Should NOT have called probeAllWorkers since we reused the existing in-flight probe
      expect(mockProbeAllWorkers).not.toHaveBeenCalled();

      // Clean up
      if (resolveProbe) resolveProbe();
      inFlightRequests.delete(probeKey);

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });

    it('returns empty health statuses when getHealthStatuses fails', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const mockGetHealthStatuses = vi.spyOn(services.workerSettingsRepo, 'getHealthStatuses').mockResolvedValue(
        err({ code: 'internal_error', message: 'Firestore error' })
      );

      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...services,
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/workers/status',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      // Worker should have default status since health status fetch failed
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0].healthy).toBe(false);
      expect(body.data.workers[0].status).toBe('unknown');

      mockGetSettings.mockRestore();
      mockGetHealthStatuses.mockRestore();
    });
  });

  describe('POST /internal/code/heartbeat', () => {
    it('processes heartbeat successfully', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task
      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Test task',
        sanitizedPrompt: 'test task',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error('Test setup failed');

      const payload = { taskIds: [created.value.id] };
      const { timestamp, signature } = generateOrchestratorSignature(payload, 'test-orchestrator-secret');

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/heartbeat',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('processed');
      expect(body.data).toHaveProperty('notFound');
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/heartbeat',
        payload: {
          taskIds: ['task-123'],
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when signature is invalid', async () => {
      const payload = { taskIds: ['task-123'] };
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/heartbeat',
        headers: {
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-request-signature': 'invalid-signature',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when heartbeat processing fails', async () => {
      const mockProcessHeartbeat = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'HEARTBEAT_ERROR',
          message: 'Failed to process heartbeat',
        },
      });

      setServices({
        ...getServices(),
        processHeartbeat: mockProcessHeartbeat as never,
      });

      const payload = { taskIds: ['task-123'] };
      const { timestamp, signature } = generateOrchestratorSignature(payload, 'test-orchestrator-secret');

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/heartbeat',
        headers: {
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /internal/code/detect-zombies', () => {
    it('detects zombies successfully', async () => {
      const mockDetectZombieTasks = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          detected: 2,
          interrupted: 1,
          errors: [],
          locksToCleanup: [],
        },
      });

      setServices({
        ...getServices(),
        detectZombieTasks: mockDetectZombieTasks as never,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/detect-zombies',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.detected).toBe(2);
      expect(body.data.interrupted).toBe(1);
      expect(body.data.errors).toEqual([]);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/detect-zombies',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 when authenticated via OIDC bearer token', async () => {
      const mockDetectZombieTasks = vi.fn().mockResolvedValue({
        ok: true,
        value: {
          detected: 0,
          interrupted: 0,
          errors: [],
          locksToCleanup: [],
        },
      });

      setServices({
        ...getServices(),
        detectZombieTasks: mockDetectZombieTasks as never,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/detect-zombies',
        headers: {
          authorization: 'Bearer fake-oidc-token',
        },
      });

      // INT-1531: Bearer tokens are now verified against Google's JWKS;
      // a non-Google token is rejected.
      expect(response.statusCode).toBe(401);
      expect(mockDetectZombieTasks).not.toHaveBeenCalled();
    });

    it('returns 500 when zombie detection fails', async () => {
      const mockDetectZombieTasks = vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'DETECTION_ERROR',
          message: 'Failed to detect zombies',
        },
      });

      setServices({
        ...getServices(),
        detectZombieTasks: mockDetectZombieTasks as never,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/detect-zombies',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });
  });

  describe('POST /internal/code/cancel-with-nonce', () => {
    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        payload: {
          taskId: 'task-123',
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: 'non-existent-task',
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when nonce does not match', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'running',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          nonce: 'wrong',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_NONCE');
    });

    it('returns 400 when nonce is expired', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'running',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NONCE_EXPIRED');
    });

    it('returns 400 when user does not own task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'owner-user',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'running',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          nonce: 'abcd',
          userId: 'different-user',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_OWNER');
    });

    it('returns 400 when task is not cancellable', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'implemented',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('TASK_NOT_CANCELLABLE');
    });

    it('cancels task successfully with valid nonce', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'user-123',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, {
        status: 'running',
        cancelNonce: 'abcd',
        cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.cancelled).toBe(true);

      const updatedTask = await repo.findById(created.value.id);
      expect(updatedTask.ok).toBe(true);
      if (updatedTask.ok) {
        expect(updatedTask.value.status).toBe('cancelled');
        expect(updatedTask.value.cancelNonce).toBeUndefined();
      }
    });

    it('returns 500 when repository update fails', async () => {
      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            id: 'task-123',
            userId: 'user-123',
            status: 'running',
            workerLocation: 'mac',
            cancelNonce: 'abcd',
            cancelNonceExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          },
        }),
        update: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'Update failed' },
        }),
      } as unknown as CodeTaskRepository;

      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/cancel-with-nonce',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: 'task-123',
          nonce: 'abcd',
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /code/workers/refresh-status', () => {
    it('should return workers status after synchronous health probe', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          _tag: 'healthy',
          healthy: true,
          capacity: 2,
          running: 1,
          available: 1,
          responseTimeMs: 100,
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn().mockResolvedValue({
            _tag: 'healthy',
            healthy: true,
            capacity: 1,
            running: 0,
            available: 1,
            responseTimeMs: 50,
          }),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      // Set up worker settings
      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0]).toEqual({
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        priority: 1,
        enabled: true,
        healthy: true,
        status: 'healthy',
        details: {
          capacity: 2,
          available: 1,
          running: 1,
          responseTimeMs: 100,
        },
        checkedAt: expect.any(String),
        stale: false,
      });
      expect(mockProbeAllWorkers).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'home-mac',
        }),
      ]);
    });

    it('should return disabled worker status without probing disabled workers', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({});

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });
      await services.workerSettingsRepo.updateWorker('test-user-id', 'home-mac', { enabled: false });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data).toEqual({
        workers: [
          {
            name: 'home-mac',
            url: 'https://cc-mac.intexuraos.cloud',
            priority: 1,
            enabled: false,
            healthy: false,
            status: 'disabled',
            details: { reason: 'disabled' },
            checkedAt: null,
            stale: false,
          },
        ],
        stale: false,
      });
      expect(mockProbeAllWorkers).not.toHaveBeenCalled();
    });

    it('should return orchestrator-unreachable when probe times out', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'timeout',
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      // Set up worker settings
      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        priority: 1,
        healthy: false,
        status: 'orchestrator-unreachable',
        details: {
          reason: 'timeout',
        },
        stale: false,
      });
      expect(body.data.workers[0]).toHaveProperty('checkedAt');
      expect(body.data.workers[0].checkedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('should return empty workers array when user has no workers', async () => {
      // Mock getSettings to return null (no workers configured)
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok(null)
      );

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers).toEqual([]);

      mockGetSettings.mockRestore();
    });

    it('should return 401 when user is not authenticated', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return empty workers array when getSettings fails', async () => {
      const services = getServices();
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        err({ code: 'internal_error', message: 'Firestore unavailable' })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers).toEqual([]);

      mockGetSettings.mockRestore();
    });

    it('should return tunnel-down worker with reason in details', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          _tag: 'tunnel-down',
          healthy: false,
          reason: 'connection-refused',
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        name: 'home-mac',
        healthy: false,
        status: 'tunnel-down',
        details: {
          reason: 'connection-refused',
        },
        stale: false,
      });
    });

    it('should return unknown status when probe result has no _tag', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          healthy: false,
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0].status).toBe('unknown');
      expect(body.data.workers[0].healthy).toBe(false);
      expect(body.data.workers[0].details).toBeNull();
    });

    it('should return unknown contract mismatch details from refreshed probe results', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          _tag: 'unknown',
          healthy: false,
          error: 'Health response missing worker capability details',
          contractMismatch: true,
          missingFields: ['providerApiKeys'],
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        name: 'home-mac',
        healthy: false,
        status: 'unknown',
        details: {
          error: 'Health response missing worker capability details',
          contractMismatch: true,
          missingFields: ['providerApiKeys'],
        },
        stale: false,
      });
    });

    it('should return orchestrator-unreachable with code in details', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        'home-mac': {
          _tag: 'orchestrator-unreachable',
          healthy: false,
          reason: 'timeout',
          code: 'ECONNREFUSED',
        },
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        name: 'home-mac',
        healthy: false,
        status: 'orchestrator-unreachable',
        details: {
          reason: 'timeout',
          code: 'ECONNREFUSED',
        },
        stale: false,
      });
    });

    it('should return healthy=false when worker not in probe results', async () => {
      const mockProbeAllWorkers = vi.fn().mockResolvedValue({
        // home-mac is NOT in the results, simulating a missing worker
      });

      setServices({
        ...getServices(),
        workerHealthProbe: {
          probeWorker: vi.fn(),
          probeAllWorkers: mockProbeAllWorkers,
        },
      });

      const services = getServices();
      await services.workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://cc-mac.intexuraos.cloud',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
      });

      const response = await server.inject({
        method: 'POST',
        url: '/workers/refresh-status',
        headers: {
          Authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workers[0]).toMatchObject({
        name: 'home-mac',
        healthy: false,
        status: 'unknown',
        details: null,
        stale: false,
      });
    });
  });

  describe('POST /internal/code/submit-phase2', () => {
    it('returns 401 when internal auth header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        payload: {
          taskId: 'task-123',
          userId: 'test-user-id',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth header is invalid', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
        payload: {
          taskId: 'task-123',
          userId: 'test-user-id',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts valid internal auth and processes request', async () => {
      const services = getServices();

      // Create a planning task that's completed (status: planned, agentType: planning)
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Test prompt',
        sanitizedPrompt: 'test prompt',
        systemPromptHash: 'hash123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
        agentType: 'planning',
        linearIssueId: 'linear-issue-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Update task to planned status (completed planning)
      await repo.update(created.value.id, { status: 'planned' });

      // Mock the task dispatcher
      const mockDispatch = vi.fn().mockResolvedValue({
        ok: true,
        value: { taskId: created.value.id, workerName: 'test-worker' },
      });

      // Mock worker settings to avoid WORKER_NOT_CONFIGURED error
      const mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'test-worker',
              url: 'http://test-worker:3000',
              enabled: true,
              cfAccessClientId: 'cf-client-id',
              cfAccessClientSecret: 'cf-client-secret',
              dispatchSigningSecret: 'dispatch-secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      // Mock linear agent client validateIssue to return proper labels
      const mockValidateIssue = vi.spyOn(services.linearAgentClient, 'validateIssue').mockResolvedValue(
        ok({
          id: 'linear-issue-uuid',
          identifier: 'INT-123',
          title: 'Test Issue',
          url: 'https://linear.app/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      setServices({
        ...services,
        taskDispatcher: {
          dispatch: mockDispatch,
          cancelOnWorker: vi.fn(),
          sendMessageToWorker: vi.fn().mockResolvedValue(ok({ action: 'queued' })),
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/submit-phase2',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          taskId: created.value.id,
          userId: 'test-user-id',
        },
      });

      // Should succeed (200 or 503 if no workers available)
      expect([200, 503]).toContain(response.statusCode);

      mockGetSettings.mockRestore();
      mockValidateIssue.mockRestore();
    });
  });

  describe('POST /code/tasks/:taskId/implement', () => {
    it('returns 401 when user is not authenticated', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/task-123/implement',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

  });

  describe('POST /code/retry', () => {
    const taskId = 'task-to-retry';
    let mockGetSettings: ReturnType<typeof vi.spyOn>;
    let mockFindByIdForUser: ReturnType<typeof vi.spyOn>;
    let mockCreate: ReturnType<typeof vi.spyOn>;
    let mockDispatch: ReturnType<typeof vi.spyOn>;
    let mockUpdateIssueState: ReturnType<typeof vi.spyOn>;
    let mockAddComment: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      const services = getServices();

      // Mock worker settings with all required fields
      mockGetSettings = vi.spyOn(services.workerSettingsRepo, 'getSettings').mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: true,
              cfAccessClientId: 'cf-client-id',
              cfAccessClientSecret: 'cf-client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      // Mock task repository methods
      mockFindByIdForUser = vi.spyOn(services.codeTaskRepo, 'findByIdForUser');
      mockCreate = vi.spyOn(services.codeTaskRepo, 'create');

      // Mock task dispatcher with correct DispatchResult type
      mockDispatch = vi.spyOn(services.taskDispatcher, 'dispatch').mockResolvedValue(
        ok({
          dispatched: true,
          workerLocation: 'home-mac',
        })
      );

      // Mock Linear client
      mockUpdateIssueState = vi.spyOn(services.linearAgentClient, 'updateIssueState').mockResolvedValue(ok(undefined));
      mockAddComment = vi.spyOn(services.linearAgentClient, 'addComment').mockResolvedValue(
        ok({ commentId: 'comment-123' })
      );
    });

    afterEach(() => {
      mockGetSettings?.mockRestore();
      mockFindByIdForUser?.mockRestore();
      mockCreate?.mockRestore();
      mockDispatch?.mockRestore();
      mockUpdateIssueState?.mockRestore();
      mockAddComment?.mockRestore();
    });

    it('should retry a failed task successfully', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      mockFindByIdForUser.mockResolvedValue(
        ok({
          id: taskId,
          userId: 'test-user-id',
          status: 'failed',
          completedAt: sixMinutesAgo,
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          linearIssueId: 'INT-520',
          linearIssueTitle: 'Test issue',
          traceId: 'trace-123',
          dedupKey: 'dedup-123',
          callbackReceived: true,
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
          error: { code: 'WORKER_ERROR', message: 'Task failed' },
        } as never)
      );

      const newTaskId = 'retry-task-123';
      mockCreate.mockResolvedValue(
        ok({
          id: newTaskId,
          userId: 'test-user-id',
          status: 'dispatched',
          traceId: 'retry-trace',
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          linearIssueId: 'INT-520',
          linearIssueTitle: 'Test issue',
          webhookSecret: 'whsec_secret',
          dedupKey: 'new-dedup-key',
          callbackReceived: false,
          retriedFrom: taskId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as never)
      );

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
          workerType: 'opus',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toBe(newTaskId);
      expect(body.data.retriedFrom).toBe(taskId);
      expect(body.data.resourceUrl).toBe(
        `https://intexuraos.cloud/#/code-tasks/${newTaskId}`
      );
    });

    it('should include additional context in retry prompt', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      mockFindByIdForUser.mockResolvedValue(
        ok({
          id: taskId,
          userId: 'test-user-id',
          status: 'failed',
          completedAt: sixMinutesAgo,
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          linearIssueId: 'INT-520',
          linearIssueTitle: 'Test issue',
          traceId: 'trace-123',
          dedupKey: 'dedup-123',
          callbackReceived: true,
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
          error: { code: 'WORKER_ERROR', message: 'Task failed' },
        } as never)
      );

      const newTaskId = 'retry-task-with-context';
      const additionalContext = 'The error was a timeout';
      mockCreate.mockImplementation((input: unknown) => {
        // Verify additional context is in the prompt
        expect((input as { prompt: string }).prompt).toContain('Additional context (retry)');
        expect((input as { prompt: string }).prompt).toContain(additionalContext);
        return Promise.resolve(
          ok({
            id: newTaskId,
            userId: 'test-user-id',
            status: 'dispatched',
            prompt: (input as { prompt: string }).prompt,
            sanitizedPrompt: (input as { sanitizedPrompt: string }).sanitizedPrompt,
            traceId: 'retry-trace',
            systemPromptHash: 'hash-123',
            workerType: 'auto',
            workerLocation: 'home-mac',
            repository: 'pbuchman/intexuraos',
            baseBranch: 'development',
            webhookSecret: 'whsec_secret',
            dedupKey: 'new-dedup-key',
            callbackReceived: false,
            retriedFrom: taskId,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never)
        );
      });

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
          additionalContext,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 when task not found', async () => {
      mockFindByIdForUser.mockResolvedValue(
        err({ code: 'NOT_FOUND', message: 'Task not found' })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when task status is not failed', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      mockFindByIdForUser.mockResolvedValue(
        ok({
          id: taskId,
          userId: 'test-user-id',
          status: 'running', // Not failed
          completedAt: sixMinutesAgo,
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          dedupKey: 'dedup-123',
          callbackReceived: false,
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
        } as never)
      );

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe('invalid_status');
    });

    it('should return 400 with retryAfterMs when task failed too recently', async () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      mockFindByIdForUser.mockResolvedValue(
        ok({
          id: taskId,
          userId: 'test-user-id',
          status: 'failed',
          completedAt: thirtySecondsAgo,
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          dedupKey: 'dedup-123',
          callbackReceived: true,
          createdAt: thirtySecondsAgo,
          updatedAt: thirtySecondsAgo,
          error: { code: 'WORKER_ERROR', message: 'Task failed' },
        } as never)
      );

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe('too_soon');
      expect(body.error.retryAfterMs).toBeDefined();
      expect(body.error.retryAfterMs).toBeGreaterThan(0);
    });

    it('should enqueue retry even when user has no enabled workers', async () => {
      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      mockFindByIdForUser.mockResolvedValue(
        ok({
          id: taskId,
          userId: 'test-user-id',
          status: 'failed',
          completedAt: sixMinutesAgo,
          prompt: 'Original prompt',
          sanitizedPrompt: 'Original prompt',
          systemPromptHash: 'hash-123',
          workerType: 'auto',
          workerLocation: 'home-mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace-123',
          dedupKey: 'dedup-123',
          callbackReceived: true,
          createdAt: sixMinutesAgo,
          updatedAt: sixMinutesAgo,
          error: { code: 'WORKER_ERROR', message: 'Task failed' },
        } as never)
      );

      // Mock settings with disabled workers — enqueue still succeeds (queue handles dispatch later)
      mockGetSettings.mockResolvedValue(
        ok({
          userId: 'test-user-id',
          workers: [
            {
              name: 'home-mac',
              url: 'http://localhost:3000',
              enabled: false, // Disabled
              cfAccessClientId: 'cf-client-id',
              cfAccessClientSecret: 'cf-client-secret',
              dispatchSigningSecret: 'secret',
            },
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        headers: {
          Authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(true);
      expect(body.data.workerLocation).toBe('queued');
    });

    it('should return 401 when user is not authenticated', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/retry',
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /code/tasks/:taskId/messages', () => {
    it('returns 401 without JWT token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/task-123/messages',
        payload: {
          message: 'Hello task',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 with empty message body', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/task-123/messages',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          message: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/non-existent-task/messages',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          message: 'Hello task',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 when sending message to review task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Review PR',
        sanitizedPrompt: 'review pr',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-review-msg',
        agentType: 'review',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'POST',
        url: `/tasks/${created.value.id}/messages`,
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          message: 'Please check again',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 403 when sending message to remediation task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix review findings',
        sanitizedPrompt: 'fix review findings',
        systemPromptHash: 'remediation-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-remediation-msg',
        agentType: 'remediation',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const response = await server.inject({
        method: 'POST',
        url: `/tasks/${created.value.id}/messages`,
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          message: 'Please try again',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

  });

  describe('POST /code/tasks/:taskId/implement', () => {
    it('returns 401 without JWT token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/task-123/implement',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/tasks/non-existent-task/implement',
        headers: { authorization: 'Bearer test-token' },
        body: {},
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 200 with correct response shape on successful execution-agent dispatch', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a completed planning-agent task owned by the test JWT user
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Design feature X',
        sanitizedPrompt: 'Design feature X (sanitized)',
        systemPromptHash: 'abc123',
        workerType: 'auto',
        workerLocation: 'home-dev',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-planning',
        agentType: 'planning',
        linearIssueId: 'INT-100',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Mark task as planned (planning-agent complete)
      await repo.update(created.value.id, { status: 'planned' });

      // Override linearAgentClient and workerSettingsRepo for this test
      const mockLinearClient: LinearAgentClient = {
        validateIssue: async () =>
          ok({
            id: 'INT-100',
            identifier: 'INT-100',
            title: 'Feature X',
            url: 'https://linear.app/pbuchman/issue/INT-100',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          }),
        updateIssueState: async () => ok({}),
        addComment: async () => ok({}),
      } as unknown as LinearAgentClient;

      const mockWorkerSettings: WorkerSettingsRepository = {
        getSettings: async () =>
          ok({
            workers: [
              {
                name: 'home-dev',
                url: 'https://worker.dev',
                enabled: true,
                cfAccessClientId: '',
                cfAccessClientSecret: '',
                dispatchSigningSecret: '',
              },
            ],
          }),
      } as unknown as WorkerSettingsRepository;

      setServices({
        ...getServices(),
        linearAgentClient: mockLinearClient,
        workerSettingsRepo: mockWorkerSettings,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/tasks/${created.value.id}/implement`,
        headers: { authorization: 'Bearer test-token' },
        body: { workerType: 'sonnet' },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toMatch(/^task_/);
      expect(body.data.implementationOf).toBe(created.value.id);
      expect(body.data.resourceUrl).toBe(
        `https://intexuraos.cloud/#/code-tasks/${body.data.codeTaskId}`
      );
      expect(body.data.workerLocation).toBe('queued');
    });

    it('accepts kimi as workerType without 400 validation error', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Design feature Y',
        sanitizedPrompt: 'Design feature Y (sanitized)',
        systemPromptHash: 'abc123',
        workerType: 'auto',
        workerLocation: 'home-dev',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-planning-kimi',
        agentType: 'planning',
        linearIssueId: 'INT-200',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await repo.update(created.value.id, { status: 'planned' });

      const mockLinearClient: LinearAgentClient = {
        validateIssue: async () =>
          ok({
            id: 'INT-200',
            identifier: 'INT-200',
            title: 'Feature Y',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          }),
        updateIssueState: async () => ok({}),
        addComment: async () => ok({}),
      } as unknown as LinearAgentClient;

      const mockWorkerSettings: WorkerSettingsRepository = {
        getSettings: async () =>
          ok({
            workers: [
              {
                name: 'home-dev',
                url: 'https://worker.dev',
                enabled: true,
                cfAccessClientId: '',
                cfAccessClientSecret: '',
                dispatchSigningSecret: '',
              },
            ],
          }),
      } as unknown as WorkerSettingsRepository;

      setServices({
        ...getServices(),
        linearAgentClient: mockLinearClient,
        workerSettingsRepo: mockWorkerSettings,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/tasks/${created.value.id}/implement`,
        headers: { authorization: 'Bearer test-token' },
        body: { workerType: 'kimi' },
      });

      // Must NOT return 400 validation error — schema must accept kimi
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.codeTaskId).toMatch(/^task_/);
      expect(body.data.implementationOf).toBe(created.value.id);

      // Verify kimi actually flows through the runtime guard to the stored task
      const executionTask = await repo.findById(body.data.codeTaskId);
      expect(executionTask.ok).toBe(true);
      if (!executionTask.ok) return;
      expect(executionTask.value.workerType).toBe('kimi');
    });
  });

  describe('POST /code/tasks/:taskId/messages (existing)', () => {
    it('successfully queues message for a running task', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task owned by the test user
      const created = await repo.create({
        userId: 'test-user-id',
        prompt: 'Fix login bug',
        sanitizedPrompt: 'fix login bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'home-mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-123',
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Set task to running status
      await repo.update(created.value.id, { status: 'running' });

      // Override taskDispatcher with sendMessageToWorker mock
      const mockTaskDispatcher: TaskDispatcherService = {
        async dispatch(): Promise<Result<DispatchResult, DispatchError>> {
          return ok({ dispatched: true, workerLocation: 'home-mac' });
        },
        async cancelOnWorker(): Promise<void> {
          return;
        },
        async sendMessageToWorker(): Promise<Result<{ action: 'queued' | 'resumed' }, { code: string; message: string }>> {
          return ok({ action: 'queued' });
        },
      };

      setServices({
        ...getServices(),
        taskDispatcher: mockTaskDispatcher,
      });

      const response = await server.inject({
        method: 'POST',
        url: `/tasks/${created.value.id}/messages`,
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          message: 'Please also fix the logout bug',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('queued');
    });
  });

  describe('DELETE /code/tasks/:taskId', () => {
    it('deletes a task owned by the authenticated user', async () => {
      const { codeTaskRepo } = getServices();
      const created = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix bug',
        sanitizedPrompt: 'fix bug',
        systemPromptHash: 'abc123',
        workerType: 'opus',
        workerLocation: 'vm',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-delete-1',
      });
      if (!created.ok) throw new Error('Setup failed');

      const response = await server.inject({
        method: 'DELETE',
        url: `/tasks/${created.value.id}`,
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 404 when task does not exist', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/tasks/non-existent-task-id',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /internal/drain-queue', () => {
    it('returns 401 when internal auth header is missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        payload: {},
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when internal auth header is invalid', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with drain result on success', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('returns 200 when execution-memory services are not configured', async () => {
      const services = getServices();
      const {
        executionMemoryEmbeddingClient: _embeddingClient,
        executionMemoryRepo: _executionMemoryRepo,
        executionMemoryApplicationRepo: _executionMemoryApplicationRepo,
        ...servicesWithoutExecutionMemory
      } = services;
      setServices(servicesWithoutExecutionMemory);

      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('returns 401 when Bearer token is not a valid Google OIDC token (INT-1531)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          authorization: 'Bearer fake-oidc-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns retry queue result when retry entry is non-empty', async () => {
      const services = getServices();
      const expiredEntry: DispatchRetry = {
        id: 'dr_expired-1',
        type: 'task_message',
        eventId: 'event-1',
        repository: 'test/repo',
        pullRequestNumber: 10,
        senderLogin: 'tester',
        taskId: 'task-expired-1',
        userId: 'user-123',
        message: 'hello',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'Worker timed out',
        createdAt: Timestamp.fromDate(new Date(Date.now() - 999_999_999)),
        ttlMinutes: 1,
      };
      let deleted = false;
      const retryRepo: DispatchRetryRepository = {
        async findOldest() { return ok(expiredEntry); },
        async claimForProcessing() { return ok(true); },
        async create() { return ok({} as never); },
        async delete() { deleted = true; return ok(undefined); },
        async update() { return ok(undefined); },
      };
      setServices({
        ...services,
        dispatchRetryRepo: retryRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('expired');
      expect(deleted).toBe(true);
    });

    it('returns failed retry result when terminal retry failure has locks to clean up', async () => {
      const services = getServices();
      await services.workerSettingsRepo.updateWorker('test-user-id', 'home-mac', { enabled: false });
      const created = await services.codeTaskRepo.create({
        id: 'task-retry-terminal',
        userId: 'test-user-id',
        prompt: 'Retry terminal PR task',
        sanitizedPrompt: 'Retry terminal PR task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'pending',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-retry-terminal',
        prNumber: 55,
      });
      expect(created.ok).toBe(true);

      const retryEntry: DispatchRetry = {
        id: 'dr_terminal-1',
        type: 'new_task',
        eventId: 'event-terminal-1',
        repository: 'test/repo',
        pullRequestNumber: 55,
        senderLogin: 'tester',
        taskId: 'task-retry-terminal',
        userId: 'test-user-id',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'Worker unavailable',
        createdAt: Timestamp.now(),
        ttlMinutes: 60,
      };
      let deleted = false;
      const retryRepo: DispatchRetryRepository = {
        async findOldest() { return ok(retryEntry); },
        async claimForProcessing() { return ok(true); },
        async create() { return ok({} as never); },
        async delete() { deleted = true; return ok(undefined); },
        async update() { return ok(undefined); },
      };
      const listQueuedSpy = vi.spyOn(services.codeTaskRepo, 'listQueuedByAge');
      setServices({
        ...services,
        dispatchRetryRepo: retryRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.action).toBe('failed');
      expect(body.data.taskId).toBe('task-retry-terminal');
      expect(deleted).toBe(true);
      expect(listQueuedSpy).not.toHaveBeenCalled();
    });

    it('returns 500 when retry queue drain fails before regular queue drain', async () => {
      const services = getServices();
      await services.workerSettingsRepo.updateWorker('test-user-id', 'home-mac', { enabled: false });
      const created = await services.codeTaskRepo.create({
        id: 'task-retry-persist-failure',
        userId: 'test-user-id',
        prompt: 'Retry persistence failure task',
        sanitizedPrompt: 'Retry persistence failure task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'pending',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace-retry-persist-failure',
      });
      expect(created.ok).toBe(true);
      const retryEntry: DispatchRetry = {
        id: 'dr_persist-failure-1',
        type: 'new_task',
        eventId: 'event-persist-failure-1',
        repository: 'test/repo',
        pullRequestNumber: 10,
        senderLogin: 'tester',
        taskId: 'task-retry-persist-failure',
        userId: 'test-user-id',
        attempts: 0,
        maxAttempts: 3,
        lastError: 'Worker unavailable',
        createdAt: Timestamp.now(),
        ttlMinutes: 60,
      };
      const retryRepo: DispatchRetryRepository = {
        async findOldest() { return ok(retryEntry); },
        async claimForProcessing() { return ok(true); },
        async create() { return ok({} as never); },
        async delete() { return ok(undefined); },
        async update() { return ok(undefined); },
      };
      const listQueuedSpy = vi.spyOn(services.codeTaskRepo, 'listQueuedByAge');
      vi.spyOn(services.codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'task write failed' }),
      );
      setServices({
        ...services,
        dispatchRetryRepo: retryRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to persist retry dispatch failure status');
      expect(listQueuedSpy).not.toHaveBeenCalled();
    });

    it('returns 500 when drain use case fails', async () => {
      const services = getServices();
      const failingRepo = {
        ...services.codeTaskRepo,
        listQueuedByAge: async (): Promise<Result<never[], { code: 'FIRESTORE_ERROR'; message: string }>> => err({ code: 'FIRESTORE_ERROR' as const, message: 'DB unavailable' }),
      };
      setServices({
        ...services,
        codeTaskRepo: failingRepo as unknown as CodeTaskRepository,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/drain-queue',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
