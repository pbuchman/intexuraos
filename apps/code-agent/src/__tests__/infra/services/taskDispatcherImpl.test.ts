/**
 * Tests for taskDispatcherImpl.ts v8 ignore blocks.
 *
 * Covers: extractErrorMessage, HMAC signing failure in sendMessageToWorker,
 * non-OK responses in sendMessageToWorker, and non-OK responses in cancelOnWorker.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { createTaskDispatcherService } from '../../../infra/services/taskDispatcherImpl.js';
import type { TaskDispatcherDeps } from '../../../domain/services/taskDispatcher.js';
import type { Logger } from '@intexuraos/common-core';

const WORKER_URL = 'https://test-worker.example.com';

const workerCredentials = {
  url: WORKER_URL,
  cfAccessClientId: 'test-client-id',
  cfAccessClientSecret: 'test-client-secret',
  dispatchSigningSecret: 'test-signing-secret-at-least-32-chars-long',
};

describe('taskDispatcherImpl', () => {
  let logger: Logger;
  let deps: TaskDispatcherDeps;

  beforeEach(() => {
    nock.cleanAll();

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    deps = {
      logger,
      workerHealthProbe: {
        probeWorker: vi.fn(),
        probeAllWorkers: vi.fn(),
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('extractErrorMessage (via sendMessageToWorker non-OK response)', () => {
    it('extracts error from JSON response body', async () => {
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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

    it('uses raw text when JSON has no error field', async () => {
      const service = createTaskDispatcherService(deps);

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
        // parsed.error is undefined (key absent), so extractErrorMessage falls through to raw text
        expect(result.error.message).toContain('422');
      }
    });
  });

  describe('sendMessageToWorker HMAC signing failure', () => {
    it('returns signing_failed when dispatchSigningSecret is empty', async () => {
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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
      const service = createTaskDispatcherService(deps);

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

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-cancel-ok', location: 'test-worker' }),
        'Worker cancellation request successful'
      );
    });
  });

  describe('cancelOnWorker non-OK response', () => {
    it('logs warning and returns when worker returns non-OK status', async () => {
      const service = createTaskDispatcherService(deps);

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

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-cancel-fail', location: 'test-worker', status: 500 }),
        'Worker cancellation request failed'
      );
    });

    it('completes without throwing when worker returns 404', async () => {
      const service = createTaskDispatcherService(deps);

      nock(WORKER_URL)
        .delete('/tasks/task-not-found')
        .reply(404, 'Not Found');

      await service.cancelOnWorker(
        'task-not-found',
        'test-worker',
        {
          url: WORKER_URL,
          cfAccessClientId: 'test-client-id',
          cfAccessClientSecret: 'test-client-secret',
        }
      );

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-not-found', location: 'test-worker', status: 404 }),
        'Worker cancellation request failed'
      );
    });
  });
});
