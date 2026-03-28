/**
 * Tests for worker settings routes.
 *
 * Tests:
 * - GET /code/worker-settings
 * - POST /code/worker-settings/workers
 * - PATCH /code/worker-settings/workers/:name
 * - DELETE /code/worker-settings/workers/:name
 * - POST /code/worker-settings/workers/:name/test
 * - PUT /code/worker-settings/priority
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

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
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { ok, err } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ServiceContainer } from '../../services.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';

describe('Worker Settings Routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe });

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

    const linearAgentClient = createLinearAgentHttpClient(
      {
        baseUrl: 'http://linear-agent:8086',
        internalAuthToken: 'test-token',
        timeoutMs: 10000,
      },
      logger
    );

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      actionsAgentClient,
      linearAgentClient,
      rateLimitService: {
        async checkLimits() {
          return ok(undefined);
        },
        async recordTaskStart() {
          return;
        },
        async recordTaskComplete() {
          return;
        },
      },
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
      workerSettingsRepo,
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
    } as ServiceContainer);

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  describe('GET /code/worker-settings', () => {
    it('should return empty workers array for new user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { workers: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.workers).toEqual([]);
    });

    it('should return 500 when repo returns error', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'getSettings').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore error: connection lost' })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('connection lost');
    });

    it('should return masked secrets for configured workers', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'client-id-12345',
        cfAccessClientSecret: 'secret-abcdef',
        dispatchSigningSecret: 'signing-xyz123',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { workers: { name: string; url: string; cfAccessClientId: string; cfAccessClientSecret: string; enabled: boolean }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0]?.name).toBe('home-mac');
      expect(body.data.workers[0]?.url).toBe('https://mac.example.com');
      expect(body.data.workers[0]?.cfAccessClientId).toContain('•');
      expect(body.data.workers[0]?.cfAccessClientId.endsWith('345')).toBe(true);
      expect(body.data.workers[0]?.cfAccessClientSecret).toContain('•');
      expect(body.data.workers[0]?.cfAccessClientSecret.endsWith('def')).toBe(true);
      expect(body.data.workers[0]?.enabled).toBe(true);
    });

    it('should include test result fields in GET response after worker test', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      // Add a worker
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'tested-worker',
        url: 'https://tested-worker.example.com',
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-signing',
      });

      // Mock the health endpoint for worker test
      nock('https://tested-worker.example.com')
        .get('/health')
        .reply(200, { status: 'ok' });

      // Test the worker to populate testStatus/testMessage/lastTestedAt
      await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/tested-worker/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      // GET settings and verify test fields are included in masked response
      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          workers: {
            name: string;
            testStatus?: string;
            testMessage?: string;
            lastTestedAt?: string;
          }[];
        };
      };
      expect(body.success).toBe(true);
      const worker = body.data.workers.find((w) => w.name === 'tested-worker');
      expect(worker).toBeDefined();
      expect(worker?.testStatus).toBe('success');
      expect(worker?.testMessage).toBe('Connection successful');
      expect(worker?.lastTestedAt).toBeDefined();
    });

    it('should mask short secrets (≤3 chars) as three bullets', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      // Add worker with very short secrets (2 chars) to test edge case masking
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'short-secret-worker',
        url: 'https://worker.example.com',
        cfAccessClientId: 'ab',
        cfAccessClientSecret: 'xy',
        dispatchSigningSecret: '12',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { workers: { name: string; cfAccessClientId: string; cfAccessClientSecret: string; dispatchSigningSecret: string }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.workers).toHaveLength(1);
      expect(body.data.workers[0]?.name).toBe('short-secret-worker');
      // Short secrets (≤3 chars) should be masked as exactly three bullets
      expect(body.data.workers[0]?.cfAccessClientId).toBe('•••');
      expect(body.data.workers[0]?.cfAccessClientSecret).toBe('•••');
      expect(body.data.workers[0]?.dispatchSigningSecret).toBe('•••');
    });
  });

  describe('POST /code/worker-settings/workers', () => {
    it('should add new worker', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://my-mac.example.com',
          cfAccessClientId: 'my-client-id',
          cfAccessClientSecret: 'my-secret',
          dispatchSigningSecret: 'my-signing-secret',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { added: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.added).toBe(true);
    });

    it('should enforce max workers limit', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      // Add 2 workers (max)
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id1',
        cfAccessClientSecret: 'secret1',
        dispatchSigningSecret: 'signing1',
      });
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'office-pc',
        url: 'https://office.example.com',
        cfAccessClientId: 'id2',
        cfAccessClientSecret: 'secret2',
        dispatchSigningSecret: 'signing2',
      });

      // Try to add 3rd worker
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'cloud-vm',
          url: 'https://vm.example.com',
          cfAccessClientId: 'id3',
          cfAccessClientSecret: 'secret3',
          dispatchSigningSecret: 'signing3',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('should reject duplicate worker name with CONFLICT', async () => {
      // First add a worker
      await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://my-mac.example.com',
          cfAccessClientId: 'my-client-id',
          cfAccessClientSecret: 'my-secret',
          dispatchSigningSecret: 'my-signing-secret',
        },
      });

      // Try to add again with same name
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://different.example.com',
          cfAccessClientId: 'different-id',
          cfAccessClientSecret: 'different-secret',
          dispatchSigningSecret: 'different-signing',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toContain('already exists');
    });

    it('should fallback to INTERNAL_ERROR for unmapped error codes on add', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'addWorker').mockResolvedValueOnce(
        err({ code: 'unknown_error_code' as never, message: 'Unexpected error' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'test-worker',
          url: 'https://example.com',
          cfAccessClientId: 'real-id',
          cfAccessClientSecret: 'real-secret',
          dispatchSigningSecret: 'real-signing',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should use fallback userId when JWT sub is null', async () => {
      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: null, email: 'test@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'test-worker',
          url: 'https://example.com',
          cfAccessClientId: 'real-id',
          cfAccessClientSecret: 'real-secret',
          dispatchSigningSecret: 'real-signing',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { added: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.added).toBe(true);
    });

    it('should return 500 when repo returns internal error on add', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'addWorker').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore error: write failed' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://my-mac.example.com',
          cfAccessClientId: 'my-client-id',
          cfAccessClientSecret: 'my-secret',
          dispatchSigningSecret: 'my-signing-secret',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('write failed');
    });

    it('should validate worker name format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'AB', // invalid: too short, uppercase (requires 3-32 chars, lowercase alphanumeric with hyphens)
          url: 'https://example.com',
          cfAccessClientId: 'id',
          cfAccessClientSecret: 'secret',
          dispatchSigningSecret: 'signing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject masked cfAccessClientId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://example.com',
          cfAccessClientId: '•••••••345', // masked value
          cfAccessClientSecret: 'real-secret',
          dispatchSigningSecret: 'real-signing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('CF Access Client ID');
      expect(body.error.message).toContain('masked');
    });

    it('should reject masked cfAccessClientSecret', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://example.com',
          cfAccessClientId: 'real-id',
          cfAccessClientSecret: '•••••def', // masked value
          dispatchSigningSecret: 'real-signing',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('CF Access Client Secret');
    });

    it('should reject masked dispatchSigningSecret', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'home-mac',
          url: 'https://example.com',
          cfAccessClientId: 'real-id',
          cfAccessClientSecret: 'real-secret',
          dispatchSigningSecret: '•••123', // masked value
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Orchestrator Secret');
    });
  });

  describe('PATCH /code/worker-settings/workers/:name', () => {
    beforeEach(async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });
    });

    it('should update existing worker', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://new-mac.example.com',
          cfAccessClientId: 'new-client-id',
          cfAccessClientSecret: 'new-secret',
          dispatchSigningSecret: 'new-signing-secret',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);
    });

    it('should support partial updates', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          enabled: false,
        },
      });

      expect(response.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { workers: { enabled: boolean }[] };
      };
      expect(getBody.data.workers[0]?.enabled).toBe(false);
    });

    it('should return 404 for non-existent worker', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/cloud-vm',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should reject masked credentials in update', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://new-url.example.com',
          cfAccessClientId: '•••••••xyz', // masked value
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('masked');
    });

    it('should fallback to INTERNAL_ERROR for unmapped error codes on update', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'updateWorker').mockResolvedValueOnce(
        err({ code: 'unknown_error_code' as never, message: 'Unexpected error' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://new-url.example.com',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should use fallback userId when JWT sub is null', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('unknown-user', {
        name: 'null-user-worker',
        url: 'https://example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: null, email: 'test@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/null-user-worker',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://updated.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);
    });

    it('should return 500 when repo returns internal error on update', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'updateWorker').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore error: update failed' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://new-url.example.com',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('update failed');
    });

    it('should allow partial update with url only (no credentials)', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/workers/home-mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://updated-mac.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);
    });
  });

  describe('DELETE /code/worker-settings/workers/:name', () => {
    beforeEach(async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });
    });

    it('should delete existing worker', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/home-mac',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      const getBody = JSON.parse(getResponse.body) as { success: boolean; data: { workers: unknown[] } };
      expect(getBody.data.workers).toEqual([]);
    });

    it('should preserve default review worker type when deleting the last worker', async () => {
      const patchResponse = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: { workerType: 'glm' },
      });

      expect(patchResponse.statusCode).toBe(200);

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/home-mac',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(deleteResponse.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { workers: unknown[]; defaultReviewWorkerType?: string };
      };
      expect(getBody.data.workers).toEqual([]);
      expect(getBody.data.defaultReviewWorkerType).toBe('glm');
    });

    it('should return 404 for non-existent worker', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/cloud-vm',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should fallback to INTERNAL_ERROR for unmapped error codes on delete', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'deleteWorker').mockResolvedValueOnce(
        err({ code: 'unknown_error_code' as never, message: 'Unexpected error' })
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/home-mac',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('should use fallback userId when JWT sub is null', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('unknown-user', {
        name: 'null-user-worker',
        url: 'https://example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: null, email: 'test@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/null-user-worker',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('should return 500 when repo returns internal error on delete', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'deleteWorker').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore error: delete failed' })
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/workers/home-mac',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('delete failed');
    });
  });

  describe('POST /code/worker-settings/workers/:name/test', () => {
    beforeEach(async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac-worker.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });
    });

    it('should return 404 for non-existent worker', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/cloud-vm/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should test connectivity and update result on success', async () => {
      nock('https://mac-worker.example.com')
        .get('/health')
        .reply(200, { status: 'ok' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/home-mac/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          testStatus: string;
          testMessage: string;
          lastTestedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.testStatus).toBe('success');
      expect(body.data.testMessage).toBe('Connection successful');
      expect(body.data.lastTestedAt).toBeDefined();
    });

    it('should use fallback userId when JWT sub is null', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('unknown-user', {
        name: 'null-user-worker',
        url: 'https://null-worker.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      nock('https://null-worker.example.com')
        .get('/health')
        .reply(200, { status: 'ok' });

      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: null, email: 'test@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/null-user-worker/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { testStatus: string; testMessage: string; lastTestedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.testStatus).toBe('success');
    });

    it('should return 500 when repo returns error on getWorkerByName', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'getWorkerByName').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore error: read failed' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/home-mac/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('read failed');
    });

    it('should record failure when fetch throws network error', async () => {
      nock('https://mac-worker.example.com')
        .get('/health')
        .replyWithError('ECONNREFUSED');

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/home-mac/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          testStatus: string;
          testMessage: string;
          lastTestedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.testStatus).toBe('failure');
      expect(body.data.testMessage).toContain('Connection failed');
    });

    it('should record failure when health check fails', async () => {
      nock('https://mac-worker.example.com')
        .get('/health')
        .reply(503, 'Service Unavailable');

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/workers/home-mac/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          testStatus: string;
          testMessage: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.testStatus).toBe('failure');
      expect(body.data.testMessage).toContain('503');
    });
  });

  describe('PUT /code/worker-settings/priority', () => {
    beforeEach(async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'home-mac',
        url: 'https://mac.example.com',
        cfAccessClientId: 'id1',
        cfAccessClientSecret: 'secret1',
        dispatchSigningSecret: 'signing1',
      });
      await workerSettingsRepo.addWorker('test-user-id', {
        name: 'office-pc',
        url: 'https://office.example.com',
        cfAccessClientId: 'id2',
        cfAccessClientSecret: 'secret2',
        dispatchSigningSecret: 'signing2',
      });
    });

    it('should reorder workers', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/code/worker-settings/priority',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          workerNames: ['office-pc', 'home-mac'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { reordered: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.reordered).toBe(true);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { workers: { name: string }[] };
      };
      expect(getBody.data.workers[0]?.name).toBe('office-pc');
      expect(getBody.data.workers[1]?.name).toBe('home-mac');
    });

    it('should return error for non-existent worker', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/code/worker-settings/priority',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          workerNames: ['home-mac', 'cloud-vm'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('should use fallback userId when JWT sub is null', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      await workerSettingsRepo.addWorker('unknown-user', {
        name: 'worker-aaa',
        url: 'https://aaa.example.com',
        cfAccessClientId: 'id1',
        cfAccessClientSecret: 'secret1',
        dispatchSigningSecret: 'signing1',
      });
      await workerSettingsRepo.addWorker('unknown-user', {
        name: 'worker-bbb',
        url: 'https://bbb.example.com',
        cfAccessClientId: 'id2',
        cfAccessClientSecret: 'secret2',
        dispatchSigningSecret: 'signing2',
      });

      mockedJwtVerify.mockResolvedValueOnce({
        payload: { sub: null, email: 'test@example.com' },
        protectedHeader: new Uint8Array(),
      } as never);

      const response = await app.inject({
        method: 'PUT',
        url: '/code/worker-settings/priority',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          workerNames: ['worker-bbb', 'worker-aaa'],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { reordered: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.reordered).toBe(true);
    });

    it('should return 400 when repo returns error on reorder', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'reorderWorkers').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Reorder must contain exactly all existing worker names' })
      );

      const response = await app.inject({
        method: 'PUT',
        url: '/code/worker-settings/priority',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          workerNames: ['home-mac', 'office-pc'],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Reorder must contain');
    });
  });

  describe('PATCH /code/worker-settings/default-review-worker-type', () => {
    it('should update default review worker type with valid type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'glm' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);

      // Verify GET returns the saved value
      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });

      const getBody = JSON.parse(getResponse.body) as { success: boolean; data: { defaultReviewWorkerType?: string } };
      expect(getBody.data.defaultReviewWorkerType).toBe('glm');
    });

    it('should reject invalid worker type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'invalid-type' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 500 when updateDefaultWorkerType fails', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'updateDefaultWorkerType').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore write failed' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'opus' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Firestore write failed');
    });

    it('should save and return all 4 new default worker type fields via GET', async () => {
      const fields = [
        { endpoint: 'default-remediation-worker-type', field: 'defaultRemediationWorkerType', value: 'opus' },
        { endpoint: 'default-execution-worker-type', field: 'defaultExecutionWorkerType', value: 'glm' },
        { endpoint: 'default-planning-worker-type', field: 'defaultPlanningWorkerType', value: 'sonnet' },
        { endpoint: 'default-pull-request-worker-type', field: 'defaultPullRequestWorkerType', value: 'codex' },
      ] as const;

      for (const { endpoint, value } of fields) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/code/worker-settings/${endpoint}`,
          headers: { Authorization: 'Bearer valid-token' },
          payload: { workerType: value },
        });
        expect(response.statusCode).toBe(200);
      }

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = JSON.parse(getResponse.body) as { success: boolean; data: Record<string, unknown> };
      for (const { field, value } of fields) {
        expect(getBody.data[field]).toBe(value);
      }
    });

    it('should not include defaultReviewWorkerType in GET when not set', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { defaultReviewWorkerType?: string } };
      expect(body.data.defaultReviewWorkerType).toBeUndefined();
    });

    it('should clear default review worker type when set to auto', async () => {
      // First set a concrete value
      await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'glm' },
      });

      // Verify it was set
      const getResponse1 = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });
      const body1 = JSON.parse(getResponse1.body) as { success: boolean; data: { defaultReviewWorkerType?: string } };
      expect(body1.data.defaultReviewWorkerType).toBe('glm');

      // Now clear it by sending "auto"
      const clearResponse = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'auto' },
      });
      expect(clearResponse.statusCode).toBe(200);

      // Verify it was cleared
      const getResponse2 = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });
      const body2 = JSON.parse(getResponse2.body) as { success: boolean; data: { defaultReviewWorkerType?: string } };
      expect(body2.data.defaultReviewWorkerType).toBeUndefined();
    });

    it('should clear each default worker type field independently via auto', async () => {
      const fields = [
        { endpoint: 'default-remediation-worker-type', field: 'defaultRemediationWorkerType', value: 'opus' },
        { endpoint: 'default-execution-worker-type', field: 'defaultExecutionWorkerType', value: 'glm' },
        { endpoint: 'default-planning-worker-type', field: 'defaultPlanningWorkerType', value: 'sonnet' },
        { endpoint: 'default-pull-request-worker-type', field: 'defaultPullRequestWorkerType', value: 'codex' },
      ] as const;

      // Set all fields
      for (const { endpoint, value } of fields) {
        await app.inject({
          method: 'PATCH',
          url: `/code/worker-settings/${endpoint}`,
          headers: { Authorization: 'Bearer valid-token' },
          payload: { workerType: value },
        });
      }

      // Clear only remediation
      await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-remediation-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'auto' },
      });

      // Verify remediation cleared but others remain
      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer valid-token' },
      });
      const body = JSON.parse(getResponse.body) as {
        success: boolean;
        data: {
          defaultRemediationWorkerType?: string;
          defaultExecutionWorkerType?: string;
          defaultPlanningWorkerType?: string;
          defaultPullRequestWorkerType?: string;
        };
      };
      expect(body.data.defaultRemediationWorkerType).toBeUndefined();
      expect(body.data.defaultExecutionWorkerType).toBe('glm');
      expect(body.data.defaultPlanningWorkerType).toBe('sonnet');
      expect(body.data.defaultPullRequestWorkerType).toBe('codex');
    });

    it('should return 500 when clearDefaultWorkerType fails', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());
      vi.spyOn(workerSettingsRepo, 'clearDefaultWorkerType').mockResolvedValueOnce(
        err({ code: 'internal_error' as const, message: 'Firestore delete failed' })
      );

      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'auto' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toContain('Firestore delete failed');
    });

    it('should handle clearing when no settings document exists', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/default-review-worker-type',
        headers: { Authorization: 'Bearer valid-token' },
        payload: { workerType: 'auto' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.data.updated).toBe(true);
    });
  });

  describe('authentication', () => {
    it('should return 401 without valid token', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('Invalid token'));

      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer invalid-token' },
      });

      expect(response.statusCode).toBe(401);
    });
  });


});
