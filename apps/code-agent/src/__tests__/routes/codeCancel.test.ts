/**
 * Tests for POST /code/cancel endpoint
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
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
describe('POST /code/cancel', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let cancelOnWorkerSpy: ReturnType<typeof vi.spyOn> | null;

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
    taskDispatcher = createTaskDispatcherService({
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

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    // Spy on cancelOnWorker to verify it's called
    cancelOnWorkerSpy = vi.spyOn(taskDispatcher, 'cancelOnWorker' as never).mockResolvedValue(undefined);

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
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        payload: {
          taskId: 'task-123',
        },
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

    it('returns 401 with invalid X-Internal-Auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          'x-internal-auth': 'invalid-token',
        },
        payload: {
          taskId: 'task-123',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('task not found', () => {
    it('returns 404 for non-existent task', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId: 'non-existent-task',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'task_not_found',
      });
    });
  });

  describe('ownership verification', () => {
    it('returns 403 for other user task', async () => {
      // Create a task for a different user
      const createResult = await codeTaskRepo.create({
        userId: 'other-user',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      // Try to cancel as unknown-user
      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'forbidden',
      });
    });
  });

  describe('task status validation', () => {
    it('returns 409 for already completed task', async () => {
      // Create and complete a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'completed' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'task_not_running',
      });
    });

    it('returns 409 for already cancelled task', async () => {
      // Create and cancel a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'cancelled' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'task_not_running',
      });
    });

    it('returns 409 for failed task', async () => {
      // Create and fail a task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'failed' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'task_not_running',
      });
    });
  });

  describe('successful cancellation', () => {
    it('successfully cancels a dispatched task', async () => {
      // Create a dispatched task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        status: 'cancelled',
      });

      // Verify worker was notified
      expect(cancelOnWorkerSpy).toHaveBeenCalledTimes(1);
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'mac');

      // Verify task status in Firestore
      const getResult = await codeTaskRepo.findById(taskId);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });

    it('successfully cancels a running task', async () => {
      // Create a running task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        status: 'cancelled',
      });

      // Verify worker was notified
      expect(cancelOnWorkerSpy).toHaveBeenCalledTimes(1);
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'vm');
    });

    it('calls worker to stop task', async () => {
      // Create a running task
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify cancelOnWorker was called with correct parameters
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      expect(cancelOnWorkerSpy).toHaveBeenCalledWith(taskId, 'mac');
    });

    it('handles Firestore update failure gracefully', async () => {
      // Create a running task with the same userId as the JWT mock returns
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      // Mock the codeTaskRepo.update to return an error
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce({
        ok: false,
        error: { code: 'FIRESTORE_ERROR', message: 'Firestore update failed' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        error: 'failed_to_cancel',
      });

      updateSpy.mockRestore();
    });

    it('continues cancellation even when worker notification fails', async () => {
      // Create a running task with the same userId as the JWT mock returns
      const createResult = await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'vm',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const taskId = createResult.value.id;

      await codeTaskRepo.update(taskId, { status: 'running' });

      // Mock cancelOnWorker to throw an error
      if (!cancelOnWorkerSpy) throw new Error('cancelOnWorkerSpy not initialized');
      cancelOnWorkerSpy.mockImplementationOnce(() => {
        throw new Error('Worker notification failed');
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/cancel',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          taskId,
        },
      });

      // Should still succeed - the task is cancelled in Firestore
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        status: 'cancelled',
      });

      // Verify task was still marked cancelled in Firestore
      const getResult = await codeTaskRepo.findById(taskId);
      expect(getResult.ok).toBe(true);
      if (getResult.ok) {
        expect(getResult.value.status).toBe('cancelled');
      }
    });
  });
});
