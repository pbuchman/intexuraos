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
          userId: 'user-456',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: 'Fix the login bug',
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            codeTaskId: 'code-task-456',
            resourceUrl: 'https://app.intexuraos.com/code-tasks/456',
          },
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        userId: 'user-456',
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
          success: true,
          data: {
            codeTaskId: 'code-task-789',
            resourceUrl: 'https://app.intexuraos.com/code-tasks/789',
          },
        });

      const client = createClient();
      await client.submitTask({
        actionId: 'action-123',
        userId: 'user-456',
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
          userId: 'user-456',
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
          success: true,
          data: {
            codeTaskId: 'code-task-999',
            resourceUrl: 'https://app.intexuraos.com/code-tasks/999',
          },
        });

      const client = createClient();
      await client.submitTask({
        actionId: 'action-abc',
        userId: 'user-456',
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
          success: false,
          error: {
            code: 'DUPLICATE',
            message: 'Task already exists for this approval',
            details: {
              existingTaskId: 'existing-task-789',
            },
          },
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
        userId: 'user-456',
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
          userId: 'user-456',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: specialPrompt,
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            codeTaskId: 'code-task-special',
            resourceUrl: 'https://app.intexuraos.com/code-tasks/special',
          },
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        userId: 'user-456',
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
          userId: 'user-456',
          approvalEventId: 'approval-event-uuid',
          payload: {
            prompt: unicodePrompt,
            workerType: 'auto',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            codeTaskId: 'code-task-unicode',
            resourceUrl: 'https://app.intexuraos.com/code-tasks/unicode',
          },
        });

      const client = createClient();
      const result = await client.submitTask({
        actionId: 'action-123',
        userId: 'user-456',
        approvalEventId: 'approval-event-uuid',
        payload: {
          prompt: unicodePrompt,
          workerType: 'auto',
        },
      });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles different worker types (opus, glm-5, auto)', async () => {
      const workerTypes: ('opus' | 'auto' | 'sonnet' | 'minimax' | 'glm-5')[] = ['opus', 'auto', 'sonnet', 'minimax', 'glm-5'];

      for (const workerType of workerTypes) {
        nock(baseUrl)
          .post('/internal/code/process')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(200, {
            success: true,
            data: {
              codeTaskId: `code-task-${workerType}`,
              resourceUrl: 'https://app.intexuraos.com/code-tasks/123',
            },
          });

        const client = createClient();
        const result = await client.submitTask({
          actionId: 'action-123',
          userId: 'user-456',
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

      it('returns INVALID_NONCE error on 400 with INVALID_NONCE code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'INVALID_NONCE', message: 'Nonce does not match' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('INVALID_NONCE');
          expect(result.error.message).toBe('Nonce does not match');
        }
      });

      it('returns NONCE_EXPIRED error on 400 with NONCE_EXPIRED code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'NONCE_EXPIRED', message: 'Nonce has expired' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NONCE_EXPIRED');
          expect(result.error.message).toBe('Nonce has expired');
        }
      });

      it('returns NOT_OWNER error on 403 with NOT_OWNER code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(403, { error: { code: 'NOT_OWNER', message: 'User does not own task' } });

        const client = createClient();
        const result = await client.cancelTaskWithNonce(cancelInput);

        expect(scope.isDone()).toBe(true);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NOT_OWNER');
          expect(result.error.message).toBe('User does not own task');
        }
      });

      it('returns TASK_NOT_CANCELLABLE error on 400 with TASK_NOT_CANCELLABLE code', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/cancel-with-nonce')
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(400, { error: { code: 'TASK_NOT_CANCELLABLE', message: 'Task already completed' } });

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
          expect(result.error.message).toBe(
            'Code-agent returned unrecognized error code: some_other_error. Original message: Unexpected error'
          );
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
          expect(result.error.message).toBe(
            'Code-agent returned unrecognized error code: . Original message: Unknown error'
          );
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

  describe('submitToPhase2', () => {
    const phase2Input = { taskId: 'task-123', userId: 'user-456' };

    describe('successful responses', () => {
      it('returns phase2 result on 200 response', async () => {
        const scope = nock(baseUrl)
          .post('/internal/code/submit-phase2', {
            taskId: 'task-123',
            userId: 'user-456',
          })
          .matchHeader('X-Internal-Auth', internalAuthToken)
          .reply(200, {
            success: true,
            data: {
              codeTaskId: 'phase2-task-789',
              resourceUrl: 'https://app.intexuraos.com/code-tasks/789',
              workerLocation: 'us-central1',
              implementationOf: 'task-123',
            },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(scope.isDone()).toBe(true);
        expect(isOk(result)).toBe(true);
        if (isOk(result)) {
          expect(result.value.codeTaskId).toBe('phase2-task-789');
          expect(result.value.resourceUrl).toBe('https://app.intexuraos.com/code-tasks/789');
          expect(result.value.workerLocation).toBe('us-central1');
          expect(result.value.implementationOf).toBe('task-123');
        }
      });

      it('returns UNKNOWN for invalid 200 response body', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(200, { success: false });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
        }
      });

      it('returns UNKNOWN for malformed JSON response', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(200, 'not json', { 'Content-Type': 'text/plain' });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
        }
      });
    });

    describe('error responses', () => {
      it('returns TASK_NOT_FOUND on 404', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(404, { success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('TASK_NOT_FOUND');
          expect(result.error.message).toBe('Task not found');
        }
      });

      it('maps 400 with serverCode invalid_status to INVALID_STATUS', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Not in designed status', details: { serverCode: 'invalid_status' } },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('INVALID_STATUS');
        }
      });

      it('maps 400 with serverCode no_linear_issue to NO_LINEAR_ISSUE', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'No Linear issue', details: { serverCode: 'no_linear_issue' } },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NO_LINEAR_ISSUE');
        }
      });

      it('maps 400 with serverCode label_not_ready to LABEL_NOT_READY', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Label missing', details: { serverCode: 'label_not_ready' } },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('LABEL_NOT_READY');
        }
      });

      it('falls back to INVALID_STATUS for 400 INVALID_REQUEST without serverCode', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Bad request' },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('INVALID_STATUS');
        }
      });

      it('returns UNKNOWN for 400 with unrecognized error code', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, {
            success: false,
            error: { code: 'SOMETHING_ELSE', message: 'Weird error' },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
        }
      });

      it('returns ALREADY_IMPLEMENTED on 409 with existingTaskId', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(409, {
            success: false,
            error: { code: 'already_implemented', message: 'Already done', details: { existingTaskId: 'existing-task-999' } },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('ALREADY_IMPLEMENTED');
          expect(result.error.existingTaskId).toBe('existing-task-999');
        }
      });

      it('returns ALREADY_IMPLEMENTED on 409 without existingTaskId', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(409, {
            success: false,
            error: { code: 'already_implemented', message: 'Already done' },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('ALREADY_IMPLEMENTED');
          expect(result.error.existingTaskId).toBeUndefined();
        }
      });

      it('returns ACTIVE_TASK_EXISTS on 409 with serverCode active_task_exists', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(409, {
            success: false,
            error: { code: 'CONFLICT', message: 'Active task exists', details: { serverCode: 'active_task_exists' } },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('ACTIVE_TASK_EXISTS');
        }
      });

      it('returns WORKER_NOT_CONFIGURED on 503', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(503, {
            success: false,
            error: { message: 'No workers' },
          });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('WORKER_NOT_CONFIGURED');
        }
      });

      it('returns UNKNOWN on unexpected status code', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(502, 'Bad Gateway');

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('UNKNOWN');
          expect(result.error.message).toContain('502');
        }
      });

      it('handles unparseable error response body', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .reply(400, 'not json', { 'Content-Type': 'text/plain' });

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          // Falls through to UNKNOWN because errorCode is '' (parse failed)
          expect(result.error.code).toBe('UNKNOWN');
        }
      });
    });

    describe('network errors', () => {
      it('returns NETWORK_ERROR on connection failure', async () => {
        nock(baseUrl)
          .post('/internal/code/submit-phase2')
          .replyWithError('Connection refused');

        const client = createClient();
        const result = await client.submitToPhase2(phase2Input);

        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.error.code).toBe('NETWORK_ERROR');
          expect(result.error.message).toContain('Connection refused');
        }
      });
    });
  });
});
