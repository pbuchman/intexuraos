/**
 * Tests for code routes.
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
import { resetServices, setServices, getServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import type { Logger } from 'pino';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';describe('codeRoutes', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars for worker discovery
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

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
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
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

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
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
        url: `/code/tasks/${created.value.id}`,
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const task = JSON.parse(response.body);
      expect(task.id).toBe(created.value.id);
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
        url: `/code/tasks/${created.value.id}`,
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
        url: '/code/tasks/non-existent',
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
        url: '/code/tasks/task-123',
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
        url: '/code/tasks',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks).toBeInstanceOf(Array);
      expect(body.tasks.length).toBe(2);
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
        await repo.update(task1.value.id, { status: 'completed' });
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
        url: '/code/tasks?status=completed',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks.length).toBe(1);
      expect(body.tasks[0].status).toBe('completed');
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
        url: '/code/tasks?limit=2',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks.length).toBe(2);
      expect(body.nextCursor).toBeDefined();
    });

    it('returns empty array for user with no tasks', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.tasks).toEqual([]);
    });

    it('returns 401 when missing auth header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/tasks',
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
        url: '/code/tasks?userId=user-123',
        headers: {
          authorization: 'Bearer test-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FIRESTORE_ERROR');
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
      expect(body.error.code).toBe('FIRESTORE_ERROR');
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
      const updated = await repo.update(created.value.id, { status: 'completed' });
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
      expect(body.error.code).toBe('FIRESTORE_ERROR');
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
          status: 'completed',
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
      expect(body.data.task.status).toBe('completed');
    });

    it('returns 404 when task not found', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/internal/code-tasks/non-existent-task',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          status: 'completed',
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
          status: 'completed',
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
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('calls recordTaskComplete when task status changes to completed', async () => {
      const repo = createFirestoreCodeTaskRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      });

      // Create a task first
      const createResult = await repo.create({
        userId: 'user-123',
        prompt: 'Test',
        sanitizedPrompt: 'Test',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'test/repo',
        baseBranch: 'main',
        traceId: 'trace_123',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;
      const task = createResult.value;

      const { getServices } = await import('../../services.js');
      const services = getServices();
      const recordCompleteSpy = vi.spyOn(services.rateLimitService, 'recordTaskComplete');

      const response = await server.inject({
        method: 'PATCH',
        url: `/internal/code-tasks/${task.id}`,
        headers: { 'x-internal-auth': 'test-internal-token' },
        payload: {
          status: 'completed',
          result: { branch: 'test', commits: 1, summary: 'Done' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(recordCompleteSpy).toHaveBeenCalledWith('user-123', undefined);
    });
  });

  describe('POST /internal/code/process error handling', () => {
    it('returns 500 for internal errors from repository', async () => {
      // Mock codeTaskRepo.create() to return a non-duplicate error
      const mockRepo = {
        create: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'FIRESTORE_ERROR', message: 'Database connection failed' },
        }),
      } as unknown as CodeTaskRepository;

      setServices({
        ...getServices(),
        codeTaskRepo: mockRepo,
      });

      const response = await server.inject({
        method: 'POST',
        url: '/internal/code/process',
        headers: {
          'x-internal-auth': 'test-internal-token',
        },
        payload: {
          actionId: 'action-123',
          approvalEventId: 'approval-123',
          userId: 'user-123',
          payload: {
            prompt: 'Fix the bug',
            repository: 'test/repo',
            baseBranch: 'main',
          },
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Database connection failed');
    });
  });
});

