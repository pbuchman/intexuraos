import { describe, it, expect, vi, afterEach } from 'vitest';
import nock from 'nock';
import { createCodeAgentHttpClient } from './codeAgentHttpClient.js';
import type { CodeActionPayload } from '../../domain/models/action.js';

const BASE_URL = 'http://localhost:9992';

type LogMethod = (obj: unknown, msg?: string) => void;

interface HttpLogger {
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
}

const fakeLogger: HttpLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type, no-restricted-syntax -- test helper with optional logger for testing default logger fallback
function makeClient(logger?: HttpLogger) {
  return createCodeAgentHttpClient({
    baseUrl: BASE_URL,
    internalAuthToken: 'test-token',
    ...(logger !== undefined && { logger }),
  });
}

const validPayload: CodeActionPayload = {
  prompt: 'Fix the bug in the login page that causes a crash',
  workerType: 'opus',
};

const submitTaskInput = {
  actionId: 'action_001',
  userId: 'user_001',
  approvalEventId: 'event_001',
  payload: validPayload,
};

describe('codeAgentHttpClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  describe('logger fallback (default logger fallback)', () => {
    it('creates client without logger using default', () => {
      const client = makeClient();
      expect(client).toBeDefined();
      expect(client.submitTask).toBeDefined();
      expect(client.cancelTaskWithNonce).toBeDefined();
      expect(client.submitToPhase2).toBeDefined();
    });
  });

  describe('submitTask', () => {
    it('returns ok on 200 success', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, {
          success: true,
          data: {
            codeTaskId: 'task_001',
            resourceUrl: 'https://example.com/task/1',
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task_001');
        expect(result.value.resourceUrl).toBe('https://example.com/task/1');
      }
    });

    it('returns err on 200 with invalid body (success: false) (invalid response body)', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, { success: false });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from code-agent');
      }
    });

    it('returns err on 200 with missing data (invalid response body)', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, { success: true });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from code-agent');
      }
    });

    it('returns err on 200 with non-JSON response', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(200, 'not json', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Invalid response from code-agent');
      }
    });

    it('returns err with DUPLICATE on 409 with JSON', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(409, {
          success: false,
          error: {
            code: 'DUPLICATE',
            message: 'Task already exists',
            details: { existingTaskId: 'task_existing' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE');
        expect(result.error.existingTaskId).toBe('task_existing');
      }
    });

    it('returns err with DUPLICATE on 409 with non-JSON', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(409, 'conflict', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE');
        expect(result.error.message).toBe('Task already exists for this approval');
      }
    });

    it('returns err with WORKER_UNAVAILABLE on 503 with error.message', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(503, {
          success: false,
          error: { message: 'All workers busy' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WORKER_UNAVAILABLE');
        expect(result.error.message).toBe('All workers busy');
      }
    });

    it('returns err with WORKER_UNAVAILABLE on 503 without error.message (error message fallback)', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(503, {
          success: false,
          error: { code: 'WORKER_UNAVAILABLE' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WORKER_UNAVAILABLE');
        expect(result.error.message).toBe('No workers available');
      }
    });

    it('returns err with WORKER_UNAVAILABLE on 503 with non-JSON', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(503, 'service unavailable', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WORKER_UNAVAILABLE');
        expect(result.error.message).toBe('No workers available');
      }
    });

    it('returns err with NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .replyWithError('connection refused');

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to call code-agent');
      }
    });

    it('returns err with UNKNOWN on unexpected status code', async () => {
      nock(BASE_URL)
        .post('/internal/code/process')
        .reply(418, { success: false });

      const client = makeClient(fakeLogger);
      const result = await client.submitTask(submitTaskInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('418');
      }
    });
  });

  describe('cancelTaskWithNonce', () => {
    const cancelInput = {
      taskId: 'task_001',
      nonce: 'nonce_abc',
      userId: 'user_001',
    };

    it('returns ok on 200 success', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(200, { success: true });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.cancelled).toBe(true);
      }
    });

    it('returns err TASK_NOT_FOUND on 404', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(404, {
          error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_FOUND');
      }
    });

    it('returns err NOT_OWNER on 403', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(403, {
          error: { code: 'NOT_OWNER', message: 'Not the task owner' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_OWNER');
      }
    });

    it('returns err with mapped code on 400 INVALID_NONCE', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(400, {
          error: { code: 'INVALID_NONCE', message: 'Nonce is invalid' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_NONCE');
      }
    });

    it('returns err with mapped code on 400 NONCE_EXPIRED', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(400, {
          error: { code: 'NONCE_EXPIRED', message: 'Nonce expired' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NONCE_EXPIRED');
      }
    });

    it('returns err with mapped code on 400 TASK_NOT_CANCELLABLE', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(400, {
          error: { code: 'TASK_NOT_CANCELLABLE', message: 'Task cannot be cancelled' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_CANCELLABLE');
      }
    });

    it('returns err UNKNOWN on 400 with unrecognized error code', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(400, {
          error: { code: 'SOMETHING_ELSE', message: 'Weird error' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('SOMETHING_ELSE');
      }
    });

    it('returns err NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .replyWithError('connection refused');

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('returns err UNKNOWN on unexpected status', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(418, 'teapot');

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('418');
      }
    });

    it('handles non-JSON error response gracefully', async () => {
      nock(BASE_URL)
        .post('/internal/code/cancel-with-nonce')
        .reply(404, 'not found', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.cancelTaskWithNonce(cancelInput);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_FOUND');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });

  describe('submitToPhase2', () => {
    const phase2Input = {
      taskId: 'task_001',
      userId: 'user_001',
    };

    it('returns ok on 200 success', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(200, {
          success: true,
          data: {
            codeTaskId: 'task_002',
            resourceUrl: 'https://example.com/task/2',
            workerLocation: 'us-central1',
            implementationOf: 'task_001',
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.codeTaskId).toBe('task_002');
        expect(result.value.resourceUrl).toBe('https://example.com/task/2');
        expect(result.value.workerLocation).toBe('us-central1');
        expect(result.value.implementationOf).toBe('task_001');
      }
    });

    it('returns err on 200 with invalid body', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(200, { success: false });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('returns err on 200 with non-JSON response', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(200, 'not json', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('returns err TASK_NOT_FOUND on 404', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(404, {
          error: { code: 'TASK_NOT_FOUND', message: 'Task not found' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_FOUND');
      }
    });

    it('returns err INVALID_STATUS on 400 with serverCode invalid_status', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(400, {
          error: {
            code: 'BAD_REQUEST',
            message: 'Invalid status',
            details: { serverCode: 'invalid_status' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_STATUS');
      }
    });

    it('returns err NO_LINEAR_ISSUE on 400 with serverCode no_linear_issue', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(400, {
          error: {
            code: 'BAD_REQUEST',
            message: 'No linear issue',
            details: { serverCode: 'no_linear_issue' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_LINEAR_ISSUE');
      }
    });

    it('returns err LABEL_NOT_READY on 400 with serverCode label_not_ready', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(400, {
          error: {
            code: 'BAD_REQUEST',
            message: 'Label not ready',
            details: { serverCode: 'label_not_ready' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LABEL_NOT_READY');
      }
    });

    it('returns err INVALID_STATUS on 400 with INVALID_REQUEST code and no serverCode', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(400, {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Bad request',
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_STATUS');
      }
    });

    it('returns err UNKNOWN on 400 with unknown error code and no serverCode', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(400, {
          error: {
            code: 'SOMETHING_ELSE',
            message: 'Unknown',
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
      }
    });

    it('returns err ACTIVE_TASK_EXISTS on 409 with serverCode active_task_exists', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(409, {
          error: {
            code: 'CONFLICT',
            message: 'Active task exists',
            details: { serverCode: 'active_task_exists' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ACTIVE_TASK_EXISTS');
      }
    });

    it('returns err ALREADY_IMPLEMENTED on 409 without active_task_exists serverCode', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(409, {
          error: {
            code: 'CONFLICT',
            message: 'Already implemented',
            details: { existingTaskId: 'task_existing' },
          },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ALREADY_IMPLEMENTED');
        expect(result.error.existingTaskId).toBe('task_existing');
      }
    });

    it('returns err WORKER_NOT_CONFIGURED on 503', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(503, {
          error: { message: 'Worker not configured' },
        });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WORKER_NOT_CONFIGURED');
      }
    });

    it('returns err NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .replyWithError('connection refused');

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });

    it('returns err UNKNOWN on unexpected status', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(418, 'teapot');

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('418');
      }
    });

    it('handles non-JSON error response on 404 gracefully', async () => {
      nock(BASE_URL)
        .post('/internal/code/submit-phase2')
        .reply(404, 'not found', { 'Content-Type': 'text/plain' });

      const client = makeClient(fakeLogger);
      const result = await client.submitToPhase2(phase2Input);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TASK_NOT_FOUND');
        expect(result.error.message).toBe('Unknown error');
      }
    });
  });
});
