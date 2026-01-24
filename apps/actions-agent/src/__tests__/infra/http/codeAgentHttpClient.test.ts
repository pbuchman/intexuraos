import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import nock from 'nock';
import { createCodeAgentHttpClient } from '../../../infra/http/codeAgentHttpClient.js';
import type { CodeAgentClient } from '../../../domain/ports/codeAgentClient.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

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
      logger: silentLogger,
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
});
