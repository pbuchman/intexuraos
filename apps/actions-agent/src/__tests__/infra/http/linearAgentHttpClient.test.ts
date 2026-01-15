import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import nock from 'nock';
import { createLinearAgentHttpClient } from '../../../infra/http/linearAgentHttpClient.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

const baseUrl = 'http://linear-agent.test';
const internalAuthToken = 'test-internal-token';

describe('linearAgentHttpClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  const createClient = (): LinearAgentClient =>
    createLinearAgentHttpClient({
      baseUrl,
      internalAuthToken,
      logger: silentLogger,
    });

  describe('successful responses', () => {
    it('returns completed status with resourceUrl and issueIdentifier', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', title: 'Fix bug' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            resourceUrl: 'https://linear.app/issue/TEST-123',
            issueIdentifier: 'TEST-123',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-123');
        expect(result.value.issueIdentifier).toBe('TEST-123');
      }
    });

    it('returns completed status with only issueIdentifier when resourceUrl is missing', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            issueIdentifier: 'TEST-456',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBeUndefined();
        expect(result.value.issueIdentifier).toBe('TEST-456');
      }
    });

    it('returns failed status with error message', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            error: 'Invalid Linear issue format',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Invalid Linear issue format');
      }
    });

    it('includes all fields when present in response', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            resourceUrl: 'https://linear.app/issue/TEST-789',
            issueIdentifier: 'TEST-789',
            // error field intentionally omitted (undefined)
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-789');
        expect(result.value.issueIdentifier).toBe('TEST-789');
        expect(result.value.error).toBeUndefined();
      }
    });
  });

  describe('HTTP error responses', () => {
    it('returns error for 401 Unauthorized', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(401, 'Unauthorized');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error for 403 Forbidden', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(403, 'Forbidden');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 403');
      }
    });

    it('returns error for 404 Not Found', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404, 'Not Found');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 404');
      }
    });

    it('returns error for 500 Internal Server Error', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error for 502 Bad Gateway', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(502, 'Bad Gateway');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 502');
      }
    });

    it('returns error for 503 Service Unavailable', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(503, 'Service Unavailable');

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 503');
      }
    });
  });

  describe('response validation errors', () => {
    it('returns error when success is false', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Invalid input');
      }
    });

    it('returns error when data field is missing', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Invalid response from linear-agent');
      }
    });

    it('returns error when success is false without error message', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: false,
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Invalid response from linear-agent');
      }
    });

    it('returns error when success is false with error object but undefined message', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: false,
          error: { code: 'UNKNOWN_ERROR' }, // message field omitted
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toBe('Invalid response from linear-agent');
      }
    });
  });

  describe('network failures', () => {
    it('returns error on network connection failure', async () => {
      nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call linear-agent');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns error on DNS resolution failure', async () => {
      nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call linear-agent');
        expect(result.error.message).toContain('getaddrinfo ENOTFOUND');
      }
    });

    it('returns error on timeout', async () => {
      nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ name: 'AbortError', message: 'The operation was aborted' });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call linear-agent');
        expect(result.error.message).toContain('aborted');
      }
    });
  });

  describe('request structure', () => {
    it('sends correct request body structure', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-abc', userId: 'user-xyz', title: 'Test issue title' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      const client = createClient();
      await client.processAction('action-abc', 'user-xyz', 'Test issue title');

      expect(scope.isDone()).toBe(true);
    });

    it('includes internal auth header', async () => {
      const customToken = 'custom-auth-token';
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', customToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      const client = createLinearAgentHttpClient({
        baseUrl,
        internalAuthToken: customToken,
        logger: silentLogger,
      });
      await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('special characters in input', () => {
    it('handles special characters in title', async () => {
      const specialTitle = "Fix: API's \"broken\" feature <script>alert('xss')</script>";
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', title: specialTitle },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', specialTitle);

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles unicode characters in title', async () => {
      const unicodeTitle = '修复认证漏洞 🔒 Security fix';
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', title: unicodeTitle },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', unicodeTitle);

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty string title', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', title: '' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'failed', error: 'Title is required' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', '');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.error).toBe('Title is required');
      }
    });

    it('handles very long title', async () => {
      const longTitle = 'A'.repeat(1000);
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', longTitle);

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('uses default logger when none provided', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', issueIdentifier: 'TEST-1' },
        });

      // Create client without logger to test default logger path
      const client = createLinearAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.processAction('action-123', 'user-456', 'Test');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });
});
