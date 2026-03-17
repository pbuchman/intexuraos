/**
 * Tests for GET /code/tasks and GET /code/tasks/:taskId endpoints
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
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
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

describe('GET /code/tasks endpoints', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let linearAgentClient: LinearAgentClient;

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

    linearAgentClient = createLinearAgentHttpClient({
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
      workerSettingsRepo,
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
      taskEnqueueService: {} as never,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
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
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
  });

  describe('GET /code/tasks (list)', () => {
    describe('authentication', () => {
      it('returns 401 without Authorization header', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
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
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer invalid-token',
          },
        });

        expect(response.statusCode).toBe(401);
      });
    });

    describe('successful task listing', () => {
      beforeEach(async () => {
        // Create test tasks for 'test-user-id' (what JWT mock returns)
        const userId = 'test-user-id';

        const result1 = await codeTaskRepo.create({
          userId,
          prompt: 'Task 1',
          sanitizedPrompt: 'Task 1',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_1',
        });

        if (!result1.ok) {
          throw new Error(`Failed to create test task 1: ${result1.error.message}`);
        }

        const result2 = await codeTaskRepo.create({
          userId,
          prompt: 'Task 2',
          sanitizedPrompt: 'Task 2',
          systemPromptHash: 'default',
          workerType: 'opus',
          workerLocation: 'vm',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_2',
        });

        if (!result2.ok) {
          throw new Error(`Failed to create test task 2: ${result2.error.message}`);
        }

        // Create task for different user (should not appear in results)
        const result3 = await codeTaskRepo.create({
          userId: 'other-user',
          prompt: 'Other user task',
          sanitizedPrompt: 'Other user task',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_3',
        });

        if (!result3.ok) {
          throw new Error(`Failed to create test task 3: ${result3.error.message}`);
        }
      });

      it('returns only user tasks with valid auth', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks).toBeDefined();
        expect(body.data.tasks.length).toBe(2); // Only test-user-id tasks
        expect(body.data.tasks.every((task: CodeTask) => task.userId === 'test-user-id')).toBe(true);
      });

      it('respects default pagination limit', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks.length).toBeLessThanOrEqual(20); // Default limit
      });

      it('respects custom limit parameter', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?limit=1',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks.length).toBe(1);
      });

      it('returns tasks ordered by createdAt descending', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        const timestamps = body.data.tasks.map((task: unknown) => {
          // In JSON response, Timestamp is serialized as ISO string
          const createdAt = (task as { createdAt: unknown }).createdAt;
          return new Date(createdAt as string).getTime();
        });
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
        }
      });
    });

    describe('status filtering', () => {
      beforeEach(async () => {
        const userId = 'test-user-id';

        // Create tasks with different statuses
        const task1 = await codeTaskRepo.create({
          userId,
          prompt: 'Task 1',
          sanitizedPrompt: 'Task 1',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_1',
        });

        if (task1.ok) {
          await codeTaskRepo.update(task1.value.id, { status: 'implemented' });
        }

        const task2 = await codeTaskRepo.create({
          userId,
          prompt: 'Task 2',
          sanitizedPrompt: 'Task 2',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_2',
        });

        if (task2.ok) {
          await codeTaskRepo.update(task2.value.id, { status: 'failed' });
        }
      });

      it('filters tasks by single status', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?status=implemented',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks).toBeDefined();
        expect(body.data.tasks.every((task: CodeTask) => task.status === 'implemented')).toBe(true);
      });

      it('filters tasks by comma-separated statuses', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?status=implemented,failed',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks).toBeDefined();
        const statuses = body.data.tasks.map((task: CodeTask) => task.status);
        for (const s of statuses) {
          expect(['implemented', 'failed']).toContain(s);
        }
      });

      it('ignores invalid status tokens in comma-separated list', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?status=implemented,bogus',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        // Only valid statuses are used; 'bogus' is dropped
        expect(body.data.tasks.every((task: CodeTask) => task.status === 'implemented')).toBe(true);
      });
    });

    describe('pagination', () => {
      it('accepts cursor parameter for pagination', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?cursor=task_abc123',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.tasks).toBeDefined();
      });
    });

    describe('linear issue enrichment', () => {
      it('hydrates list responses with live linearIssue data via linearAgentClient', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task with linear issue',
          sanitizedPrompt: 'Task with linear issue',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_linear_list',
          linearIssueId: 'INT-301',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        const fetchBatchSpy = vi.spyOn(
          linearAgentClient as unknown as {
            fetchIssuesForDisplay: (request: {
              userId: string;
              identifiers: string[];
            }) => Promise<unknown>;
          },
          'fetchIssuesForDisplay'
        ).mockResolvedValueOnce(ok([
          {
            identifier: 'INT-301',
            title: 'List Linear Issue',
            state: { name: 'In Progress', type: 'started' },
            priority: 1,
            assignee: { id: 'user-1', name: 'Test User' },
            labels: [{ id: 'label-1', name: 'backend' }],
            url: 'https://linear.app/intexura/issue/INT-301',
            commentCount: 2,
            lastCommentAt: '2026-03-06T12:00:00.000Z',
          },
        ]));

        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            tasks: {
              id: string;
              linearIssue?: { title: string; labels: { name: string }[] };
            }[];
          };
        };

        expect(body.success).toBe(true);
        const hydratedTask = body.data.tasks.find((item) => item.id === task.value.id);
        expect(hydratedTask?.linearIssue?.title).toBe('List Linear Issue');
        expect(hydratedTask?.linearIssue?.labels.map((label) => label.name)).toEqual(['backend']);
        expect(fetchBatchSpy).toHaveBeenCalledWith({
          userId: 'test-user-id',
          identifiers: ['INT-301'],
        });
      });

      it('returns the list without linearIssue when batch hydration fails', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task with stale linear issue',
          sanitizedPrompt: 'Task with stale linear issue',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_linear_list_error',
          linearIssueId: 'INT-999',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        const fetchBatchSpy = vi.spyOn(
          linearAgentClient as unknown as {
            fetchIssuesForDisplay: (request: {
              userId: string;
              identifiers: string[];
            }) => Promise<unknown>;
          },
          'fetchIssuesForDisplay'
        ).mockResolvedValueOnce(err({
          code: 'UNAVAILABLE',
          message: 'linear-agent unavailable',
        }));

        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            tasks: {
              id: string;
              linearIssueId?: string;
              linearIssue?: unknown;
              linearIssueTitle?: string;
              linearIssueLabels?: string[];
            }[];
          };
        };

        expect(body.success).toBe(true);
        const hydratedTask = body.data.tasks.find((item) => item.id === task.value.id);
        expect(hydratedTask?.linearIssueId).toBe('INT-999');
        expect(hydratedTask?.linearIssue).toBeUndefined();
        expect(hydratedTask?.linearIssueTitle).toBeUndefined();
        expect(hydratedTask?.linearIssueLabels).toBeUndefined();
        expect(fetchBatchSpy).toHaveBeenCalledWith({
          userId: 'test-user-id',
          identifiers: ['INT-999'],
        });
      });
    });
  });

  describe('GET /code/tasks/:taskId (get single)', () => {
    describe('authentication', () => {
      it('returns 401 without Authorization header', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks/task-123',
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
    });

    describe('task retrieval', () => {
      let testTaskId: string;
      let otherUserIdTaskId: string;

      beforeEach(async () => {
        // Create test task - userId must match the JWT mock (test-user-id)
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Test task',
          sanitizedPrompt: 'Test task',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_test',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }
        testTaskId = task.value.id;

        // Create task for different user
        const otherTask = await codeTaskRepo.create({
          userId: 'other-user',
          prompt: 'Other user task',
          sanitizedPrompt: 'Other user task',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_other',
        });

        if (!otherTask.ok) {
          throw new Error(`Failed to create other user task: ${otherTask.error.message}`);
        }
        otherUserIdTaskId = otherTask.value.id;
      });

      it('returns task details for owner', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${testTaskId}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.id).toBe(testTaskId);
        expect(body.data.userId).toBe('test-user-id');
        expect(body.data.prompt).toBe('Test task');
      });

      it('returns 404 for non-existent task', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks/non-existent-task',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body).toEqual({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Task non-existent-task not found',
          },
        });
      });

      it('returns 403 for other user task', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${otherUserIdTaskId}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(404); // Returns 404 instead of 403 for security
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_FOUND');
      });

      it('returns 500 on repository error', async () => {
        const findByIdForUserSpy = vi.spyOn(codeTaskRepo, 'findByIdForUser').mockResolvedValueOnce(
          err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
        );

        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks/task-123',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.message).toBe('Database unavailable');

        findByIdForUserSpy.mockRestore();
      });
    });

    describe('linear issue enrichment', () => {
      it('includes linearIssue when task has linearIssueId', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task with linear issue',
          sanitizedPrompt: 'Task with linear issue',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_linear',
          linearIssueId: 'INT-100',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        const mockLinearIssue = {
          identifier: 'INT-100',
          title: 'Test Linear Issue',
          state: { name: 'In Progress', type: 'started' },
          priority: 2,
          assignee: { id: 'user-1', name: 'Test User' },
          labels: [{ id: 'label-1', name: 'Code Task' }],
          url: 'https://linear.app/intexura/issue/INT-100',
          commentCount: 3,
          lastCommentAt: '2026-01-15T10:00:00.000Z',
        };

        const fetchSpy = vi.spyOn(linearAgentClient, 'fetchIssueForDisplay')
          .mockResolvedValueOnce(ok(mockLinearIssue));

        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${task.value.id}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.linearIssue).toEqual(mockLinearIssue);
        expect(fetchSpy).toHaveBeenCalledWith({
          userId: 'test-user-id',
          identifier: 'INT-100',
        });

        fetchSpy.mockRestore();
      });

      it('does not expose stored linear metadata on the task response', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task with labels',
          sanitizedPrompt: 'Task with labels',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_labels',
          linearIssueId: 'INT-200',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        vi.spyOn(linearAgentClient, 'fetchIssueForDisplay').mockResolvedValueOnce(
          ok({
            identifier: 'INT-200',
            title: 'Feature with labels',
            state: { name: 'In Progress', type: 'started' },
            priority: 2,
            assignee: null,
            labels: [],
            url: 'https://linear.app/intexura/issue/INT-200',
            commentCount: 0,
            lastCommentAt: null,
          })
        );

        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${task.value.id}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.linearIssueLabels).toBeUndefined();
        expect(body.data.linearIssueTitle).toBeUndefined();
        expect(body.data.linearIssueUrl).toBeUndefined();
        expect(body.data.linearFallback).toBeUndefined();
        expect(body.data.linearIssue.labels.map((label: { name: string }) => label.name)).toEqual([]);
      });

      it('returns task without linearIssue when task has no linearIssueId', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task without linear issue',
          sanitizedPrompt: 'Task without linear issue',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_no_linear',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        const fetchSpy = vi.spyOn(linearAgentClient, 'fetchIssueForDisplay');

        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${task.value.id}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.linearIssue).toBeUndefined();
        expect(fetchSpy).not.toHaveBeenCalled();

        fetchSpy.mockRestore();
      });

      it('returns task without linearIssue when fetch fails', async () => {
        const task = await codeTaskRepo.create({
          userId: 'test-user-id',
          prompt: 'Task with failing linear fetch',
          sanitizedPrompt: 'Task with failing linear fetch',
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: 'trace_fail_linear',
          linearIssueId: 'INT-999',
        });

        if (!task.ok) {
          throw new Error(`Failed to create test task: ${task.error.message}`);
        }

        const fetchSpy = vi.spyOn(linearAgentClient, 'fetchIssueForDisplay')
          .mockResolvedValueOnce(err({ code: 'UNAVAILABLE', message: 'linear-agent down' }));

        const response = await app.inject({
          method: 'GET',
          url: `/code/tasks/${task.value.id}`,
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.success).toBe(true);
        expect(body.data.linearIssue).toBeUndefined();

        fetchSpy.mockRestore();
      });
    });
  });
});
