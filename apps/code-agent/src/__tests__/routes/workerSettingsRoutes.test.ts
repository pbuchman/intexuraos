/**
 * Tests for worker settings routes.
 *
 * Tests:
 * - GET /code/worker-settings
 * - PATCH /code/worker-settings/:workerType
 * - DELETE /code/worker-settings/:workerType
 * - POST /code/worker-settings/:workerType/test
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
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createNoOpMetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { ServiceContainer } from '../../services.js';

describe('Worker Settings Routes', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_CODE_WORKERS'] = 'mac:https://cc-mac.intexuraos.cloud:1';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
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

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    const taskDispatcher = createTaskDispatcherService({ logger });

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
      workerDiscovery,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      actionsAgentClient,
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
      workerSettingsRepo,
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
    it('should return empty object when user has no settings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: object };
      expect(body.success).toBe(true);
      expect(body.data).toEqual({});
    });

    it('should return masked secrets for configured worker', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      await workerSettingsRepo.updateWorkerConfig('test-user-id', 'mac', {
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
        data: {
          mac?: {
            url: string;
            cfAccessClientId: string;
            cfAccessClientSecret: string;
            dispatchSigningSecret: string;
            enabled: boolean;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.mac).toBeDefined();
      expect(body.data.mac?.url).toBe('https://mac.example.com');
      expect(body.data.mac?.cfAccessClientId).toContain('•');
      expect(body.data.mac?.cfAccessClientId.endsWith('345')).toBe(true);
      expect(body.data.mac?.cfAccessClientSecret).toContain('•');
      expect(body.data.mac?.cfAccessClientSecret.endsWith('def')).toBe(true);
      expect(body.data.mac?.enabled).toBe(true);
    });
  });

  describe('PATCH /code/worker-settings/:workerType', () => {
    it('should create new worker config', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/mac',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://my-mac.example.com',
          cfAccessClientId: 'my-client-id',
          cfAccessClientSecret: 'my-secret',
          dispatchSigningSecret: 'my-signing-secret',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { updated: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.updated).toBe(true);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      const getBody = JSON.parse(getResponse.body) as {
        success: boolean;
        data: { mac?: { url: string } };
      };
      expect(getBody.data.mac?.url).toBe('https://my-mac.example.com');
    });

    it('should return error for invalid worker type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/code/worker-settings/invalid',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        payload: {
          url: 'https://example.com',
          cfAccessClientId: 'id',
          cfAccessClientSecret: 'secret',
          dispatchSigningSecret: 'signing',
        },
      });

      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('DELETE /code/worker-settings/:workerType', () => {
    it('should delete existing worker config', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      await workerSettingsRepo.updateWorkerConfig('test-user-id', 'mac', {
        url: 'https://mac.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/mac',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(deleteResponse.statusCode).toBe(200);
      const body = JSON.parse(deleteResponse.body) as { success: boolean; data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/code/worker-settings',
        headers: { Authorization: 'Bearer test-token' },
      });

      const getBody = JSON.parse(getResponse.body) as { success: boolean; data: object };
      expect(getBody.data).toEqual({});
    });

    it('should return error for invalid worker type', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/code/worker-settings/invalid',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('POST /code/worker-settings/:workerType/test', () => {
    it('should return 404 when worker not configured', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/mac/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should test connectivity and update result for configured worker', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      await workerSettingsRepo.updateWorkerConfig('test-user-id', 'mac', {
        url: 'https://mac-worker.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      nock('https://mac-worker.example.com')
        .get('/health')
        .reply(200, { status: 'ok' });

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/mac/test',
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

    it('should record failure when health check fails', async () => {
      const { workerSettingsRepo } = await import('../../services.js').then((m) => m.getServices());

      await workerSettingsRepo.updateWorkerConfig('test-user-id', 'mac', {
        url: 'https://failing-worker.example.com',
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      });

      nock('https://failing-worker.example.com')
        .get('/health')
        .reply(503, 'Service Unavailable');

      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/mac/test',
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

    it('should return error for invalid worker type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/worker-settings/invalid/test',
        headers: { Authorization: 'Bearer test-token' },
      });

      expect([400, 500]).toContain(response.statusCode);
    });
  });

  describe('authentication', () => {
    it('should return 401 without token', async () => {
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
