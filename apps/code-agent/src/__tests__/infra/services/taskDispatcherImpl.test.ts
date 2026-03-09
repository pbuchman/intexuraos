/**
 * Tests for taskDispatcherImpl.ts v8 ignore blocks.
 *
 * Covers: extractErrorMessage, HMAC signing failure in sendMessageToWorker,
 * non-OK responses in sendMessageToWorker, and non-OK responses in cancelOnWorker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import type { TaskDispatcherDeps } from '../../../domain/services/taskDispatcher.js';
import type { WorkerHealthProbe } from '../../../domain/ports/workerHealthProbe.js';
import type { Logger } from '@intexuraos/common-core';

const WORKER_URL = 'https://test-worker.example.com';

function createFakeLogger(): Logger {
  const noop = (): void => {
    /* no-op logger for tests */
  };
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    child: () => createFakeLogger(),
    fatal: noop,
    trace: noop,
    silent: noop,
    level: 'silent',
  } as unknown as Logger;
}

function createFakeHealthProbe(): WorkerHealthProbe {
  return {
    probeWorker: async () => ({
      _tag: 'healthy' as const,
      healthy: true as const,
      capacity: 2,
      running: 0,
      available: 2,
      responseTimeMs: 50,
    }),
    probeAllWorkers: async () => ({
      'test-worker': {
        _tag: 'healthy' as const,
        healthy: true as const,
        capacity: 2,
        running: 0,
        available: 2,
        responseTimeMs: 50,
      },
    }),
  };
}

function createDeps(overrides?: Partial<TaskDispatcherDeps>): TaskDispatcherDeps {
  return {
    logger: createFakeLogger(),
    workerHealthProbe: createFakeHealthProbe(),
    ...overrides,
  };
}

const workerCredentials = {
  url: WORKER_URL,
  cfAccessClientId: 'test-client-id',
  cfAccessClientSecret: 'test-client-secret',
  dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
};

describe('taskDispatcherImpl', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('extractErrorMessage (via sendMessageToWorker non-OK response)', () => {
    it('extracts error from JSON response body', async () => {
      const service = createTaskDispatcherService(createDeps());

      // Mock the message endpoint to return a non-OK response with JSON error body
      nock(WORKER_URL)
        .post('/tasks/task-123/message')
        .reply(400, { error: 'Invalid task state' });

      const result = await service.sendMessageToWorker(
        'task-123',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('Invalid task state');
        expect(result.error.message).toContain('400');
      }
    });

    it('uses plain text when response body is not JSON', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-456/message')
        .reply(400, 'Plain text error response');

      const result = await service.sendMessageToWorker(
        'task-456',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('Plain text error response');
        expect(result.error.message).toContain('400');
      }
    });

    it('uses plain text when JSON lacks error field', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-789/message')
        .reply(422, JSON.stringify({ detail: 'not the error field' }));

      const result = await service.sendMessageToWorker(
        'task-789',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        // Should contain the raw JSON string since parsed.error is not a string
        expect(result.error.message).toContain('422');
      }
    });
  });

  describe('sendMessageToWorker HMAC signing failure', () => {
    it('returns signing_failed when dispatchSigningSecret is empty', async () => {
      const service = createTaskDispatcherService(createDeps());

      const result = await service.sendMessageToWorker(
        'task-signing-fail',
        'test message',
        {
          ...workerCredentials,
          dispatchSigningSecret: '',
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('signing_failed');
        expect(result.error.message).toContain('Failed to sign message request');
      }
    });
  });

  describe('sendMessageToWorker success path', () => {
    it('returns action data when worker responds with OK status', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-success/message')
        .reply(200, { action: 'queued' });

      const result = await service.sendMessageToWorker(
        'task-success',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.action).toBe('queued');
      }
    });
  });

  describe('sendMessageToWorker non-OK response handling', () => {
    it('returns worker_unavailable for retryable infrastructure status 503', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-503/message')
        .reply(503, 'Service Unavailable');

      const result = await service.sendMessageToWorker(
        'task-503',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('503');
      }
    });

    it('returns worker_unavailable for retryable infrastructure status 502', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-502/message')
        .reply(502, 'Bad Gateway');

      const result = await service.sendMessageToWorker(
        'task-502',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('502');
      }
    });

    it('returns worker_unavailable for Cloudflare status 520', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-520/message')
        .reply(520, 'Cloudflare Error');

      const result = await service.sendMessageToWorker(
        'task-520',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_unavailable');
        expect(result.error.message).toContain('520');
      }
    });

    it('returns worker_error for non-retryable status 400', async () => {
      const service = createTaskDispatcherService(createDeps());

      nock(WORKER_URL)
        .post('/tasks/task-400/message')
        .reply(400, { error: 'Bad Request' });

      const result = await service.sendMessageToWorker(
        'task-400',
        'test message',
        workerCredentials
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('worker_error');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('Bad Request');
      }
    });
  });

  describe('cancelOnWorker success path', () => {
    it('completes successfully when worker returns OK status', async () => {
      const infoCalls: unknown[] = [];
      const logger = createFakeLogger();
      logger.info = ((...args: unknown[]) => {
        infoCalls.push(args);
      }) as unknown as Logger['info'];

      const service = createTaskDispatcherService(createDeps({ logger }));

      nock(WORKER_URL)
        .delete('/tasks/task-cancel-ok')
        .reply(200, { status: 'cancelled' });

      await service.cancelOnWorker(
        'task-cancel-ok',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      const successLog = infoCalls.find((call) => {
        const args = call as unknown[];
        return typeof args[1] === 'string' && args[1].includes('cancellation request successful');
      });
      expect(successLog).toBeDefined();
    });
  });

  describe('cancelOnWorker non-OK response', () => {
    it('logs warning and returns when worker returns non-OK status', async () => {
      const warnCalls: unknown[] = [];
      const logger = createFakeLogger();
      logger.warn = ((...args: unknown[]) => {
        warnCalls.push(args);
      }) as unknown as Logger['warn'];

      const service = createTaskDispatcherService(createDeps({ logger }));

      nock(WORKER_URL)
        .delete('/tasks/task-cancel-fail')
        .reply(500, 'Internal Server Error');

      await service.cancelOnWorker(
        'task-cancel-fail',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      // Should have logged a warning about the failed cancellation
      const cancellationWarning = warnCalls.find((call) => {
        const args = call as unknown[];
        return typeof args[1] === 'string' && args[1].includes('cancellation request failed');
      });
      expect(cancellationWarning).toBeDefined();
    });

    it('completes without throwing when worker returns 404', async () => {
      const warnCalls: unknown[] = [];
      const logger = createFakeLogger();
      logger.warn = ((...args: unknown[]) => {
        warnCalls.push(args);
      }) as unknown as Logger['warn'];

      const service = createTaskDispatcherService(createDeps({ logger }));

      nock(WORKER_URL)
        .delete('/tasks/task-not-found')
        .reply(404, 'Not Found');

      // Should not throw
      await service.cancelOnWorker(
        'task-not-found',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      // Should have logged a warning
      const cancellationWarning = warnCalls.find((call) => {
        const args = call as unknown[];
        return typeof args[1] === 'string' && args[1].includes('cancellation request failed');
      });
      expect(cancellationWarning).toBeDefined();
    });
  });
});
