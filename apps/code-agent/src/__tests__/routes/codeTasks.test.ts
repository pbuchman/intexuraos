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
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';

describe('GET /code/tasks endpoints', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;

  beforeEach(async () => {
    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    const taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
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
      workerDiscovery,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      actionsAgentClient,
      rateLimitService,
      linearIssueService,
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
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      workerDiscovery: WorkerDiscoveryService;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
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
        expect(body.tasks).toBeDefined();
        expect(body.tasks.length).toBe(2); // Only test-user-id tasks
        expect(body.tasks.every((task: CodeTask) => task.userId === 'test-user-id')).toBe(true);
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
        expect(body.tasks.length).toBeLessThanOrEqual(20); // Default limit
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
        expect(body.tasks.length).toBe(1);
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
        const timestamps = body.tasks.map((task: unknown) => {
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
          await codeTaskRepo.update(task1.value.id, { status: 'completed' });
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

      it('filters tasks by status', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/code/tasks?status=completed',
          headers: {
            authorization: 'Bearer test-token',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.tasks).toBeDefined();
        expect(body.tasks.every((task: CodeTask) => task.status === 'completed')).toBe(true);
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
        const task = JSON.parse(response.body);
        expect(task.id).toBe(testTaskId);
        expect(task.userId).toBe('test-user-id');
        expect(task.prompt).toBe('Test task');
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
    });
  });
});
