import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import nock from 'nock';
import { createCodeAgentHttpClient } from '../../../infra/http/codeAgentHttpClient.js';
import type { CodeAgentClient } from '../../../domain/ports/codeAgentClient.js';
import { createMockLogger } from '../../fakes.js';

const baseUrl = 'http://code-agent.test';
const internalAuthToken = 'test-internal-token';

describe('codeAgentHttpClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  const createClient = (): CodeAgentClient =>
    createCodeAgentHttpClient({
      baseUrl,
      internalAuthToken,
      logger: createMockLogger(),
    });

  describe('successful responses', () => {
    it('returns codeTaskId and resourceUrl on 200 response', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process', {
          actionId: 'action-123',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: 'Fix the login bug',
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          codeTaskId: 'code-task-456',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/456',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix the login bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.codeTaskId).toBe('code-task-456');
        expect(result.value.resourceUrl).toBe('https://app.intexuraos.com/code-tasks/456');
      }
    });

    it('sends correct headers (Content-Type, X-Internal-Auth)', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('Content-Type', 'application/json')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          codeTaskId: 'code-task-789',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/789',
        });

      const client = createClient();
      await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
    });

    it('request body matches expected schema', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process', {
          actionId: 'action-abc',
          approvalEventId: 'event-uuid-123',
          payload: {
            prompt: 'Implement dark mode',
            workerType: 'opus',
            linearIssueId: 'LIN-123',
            linearIssueTitle: 'Add dark mode support',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          codeTaskId: 'code-task-999',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/999',
        });

      const client = createClient();
      await client.submitTask({
        actionId: 'action-abc',
        approvalEventId: 'event-uuid-123',
        payload: {
          prompt: 'Implement dark mode',
          workerType: 'opus',
          linearIssueId: 'LIN-123',
          linearIssueTitle: 'Add dark mode support',
        },
      });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('error responses', () => {
    it('returns DUPLICATE error on 409 response with existingTaskId', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(409, {
          existingTaskId: 'existing-task-789',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('DUPLICATE');
        expect(result.error.message).toBe('Task already exists for this approval');
        expect(result.error.existingTaskId).toBe('existing-task-789');
      }
    });

    it('returns DUPLICATE error without existingTaskId when not provided', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(409, {});

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('DUPLICATE');
        expect(result.error.existingTaskId).toBeUndefined();
      }
    });

    it('returns WORKER_UNAVAILABLE error on 503 response', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(503, {
          error: 'No workers available',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('WORKER_UNAVAILABLE');
        expect(result.error.message).toBe('No workers available');
      }
    });

    it('returns WORKER_UNAVAILABLE error with default message when error field missing', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(503);

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('WORKER_UNAVAILABLE');
        expect(result.error.message).toBe('No workers available');
      }
    });

    it('returns UNKNOWN error for unexpected response code', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(418, "I'm a teapot");

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toBe('Unexpected response: 418');
      }
    });
  });

  describe('network failures', () => {
    it('returns NETWORK_ERROR on network connection failure', async () => {
      nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Failed to call code-agent');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns NETWORK_ERROR on DNS resolution failure', async () => {
      nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('getaddrinfo ENOTFOUND');
      }
    });

    it('returns NETWORK_ERROR on timeout', async () => {
      nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ name: 'AbortError', message: 'The operation was aborted' });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('aborted');
      }
    });
  });

  describe('response validation', () => {
    it('returns error on invalid JSON response', async () => {
      const scope = nock(baseUrl)
        .post('/internal/code/process')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, 'not valid json', {
          'Content-Type': 'text/plain',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: 'Fix bug',
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe('UNKNOWN');
        expect(result.error.message).toContain('Invalid response');
      }
    });
  });

  describe('edge cases', () => {
    it('handles special characters in prompt', async () => {
      const specialPrompt = "Fix: API's \"broken\" feature <script>alert('xss')</script>";
      const scope = nock(baseUrl)
        .post('/internal/code/process', {
          actionId: 'action-123',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: specialPrompt,
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          codeTaskId: 'code-task-special',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/special',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: specialPrompt,
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles unicode characters in prompt', async () => {
      const unicodePrompt = '修复认证漏洞 🔒 Security fix';
      const scope = nock(baseUrl)
        .post('/internal/code/process', {
          actionId: 'action-123',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: unicodePrompt,
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          codeTaskId: 'code-task-unicode',
          resourceUrl: 'https://app.intexuraos.com/code-tasks/unicode',
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: unicodePrompt,
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles different worker types (opus, glm, auto)', async () => {
      const workerTypes: ('opus' | 'auto' | 'glm')[] = ['opus', 'auto', 'glm'];

      for (const workerType of workerTypes) {
        nock(baseUrl)
          .post('/internal/code/process')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(200, {
            codeTaskId: `code-task-${workerType}`,
            resourceUrl: 'https://app.intexuraos.com/code-tasks/123',
          });

        const client = createClient();
        const result = await client.submitTask({
          actionId: 'action-123',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: 'Fix bug',
            workerType,
          },
        });

        expect(isOk(result)).toBe(true);
      }
    });
  });

  describe('cancelTaskWithNonce', () => {
    const cancelInput = {
      taskId: 'task-123',
      nonce: 'abcd1234',
      userId: 'user-789',
    };

    describe('successful responses', () => {
      it('returns cancelled true on 200 response', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce', {
            taskId: 'task-123',
            nonce: 'abcd1234',
            userId: 'user-789',
          })
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(200, { cancelled: true });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.cancelled).toBe(true);
        }
      });

      it('sends correct headers (Content-Type, X-Internal-Auth)', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('Content-Type', 'application/json')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(200, { cancelled: true });

        const client = createClient();
        await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
      });
    });

    describe('error responses', () => {
      it('returns TASK_NOT_FOUND error on 404 response', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(404, { error: { code: 'task_not_found', message: 'Task not found' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('TASK_NOT_FOUND');
          expect(result.error.message).toBe('Task not found');
        }
      });

      it('returns INVALID_NONCE error on 400 with invalid_nonce code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'invalid_nonce', message: 'Nonce does not match' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('INVALID_NONCE');
          expect(result.error.message).toBe('Nonce does not match');
        }
      });

      it('returns NONCE_EXPIRED error on 400 with nonce_expired code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'nonce_expired', message: 'Nonce has expired' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NONCE_EXPIRED');
          expect(result.error.message).toBe('Nonce has expired');
        }
      });

      it('returns NOT_OWNER error on 400 with not_owner code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'not_owner', message: 'User does not own task' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NOT_OWNER');
          expect(result.error.message).toBe('User does not own task');
        }
      });

      it('returns TASK_NOT_CANCELLABLE error on 400 with task_not_cancellable code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'task_not_cancellable', message: 'Task already completed' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('TASK_NOT_CANCELLABLE');
          expect(result.error.message).toBe('Task already completed');
        }
      });

      it('returns UNKNOWN error on 400 with unrecognized code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'some_other_error', message: 'Unexpected error' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
          expect(result.error.message).toBe('Unexpected error');
        }
      });

      it('returns UNKNOWN error for unexpected HTTP status', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(500, { error: 'Internal server error' });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
          expect(result.error.message).toBe('Unexpected response: 500');
        }
      });

      it('handles invalid JSON in error response gracefully', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, 'not valid json', { 'Content-Type': 'text/plain' });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
          expect(result.error.message).toBe('Unknown error');
        }
      });

      it('handles empty error response on 404', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(404);

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('TASK_NOT_FOUND');
          expect(result.error.message).toBe('Unknown error');
        }
      });
    });

    describe('network failures', () => {
      it('returns NETWORK_ERROR on connection failure', async () => {
        nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('Failed to call code-agent');
          expect(result.error.message).toContain('Connection refused');
        }
      });

      it('returns NETWORK_ERROR on timeout', async () => {
        nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .replyWithError({ name: 'AbortError', message: 'The operation was aborted' });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('aborted');
        }
      });
    });
  });
});
