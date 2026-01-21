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
    it('returns completed status with resourceUrl and message', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', text: 'Fix bug' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Linear issue created: TEST-123',
            resourceUrl: 'https://linear.app/issue/TEST-123',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Linear issue created: TEST-123');
        expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-123');
      }
    });

    it('returns completed status with message only when resourceUrl is missing', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Linear issue created: TEST-456',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Linear issue created: TEST-456');
        expect(result.value.resourceUrl).toBeUndefined();
      }
    });

    it('returns failed status with error message and errorCode', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Invalid Linear issue format',
            errorCode: 'VALIDATION_ERROR',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid Linear issue format');
        expect(result.value.errorCode).toBe('VALIDATION_ERROR');
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
            message: 'Linear issue created: TEST-789',
            resourceUrl: 'https://linear.app/issue/TEST-789',
          },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.message).toBe('Linear issue created: TEST-789');
        expect(result.value.resourceUrl).toBe('https://linear.app/issue/TEST-789');
        expect(result.value.errorCode).toBeUndefined();
      }
    });
  });

  describe('HTTP error responses', () => {
    it('returns error for 401 Unauthorized (non-JSON)', async () => {
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

    it('returns failed ServiceFeedback with errorCode on HTTP 401 with JSON body', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(401, {
          success: false,
          error: { code: 'TOKEN_ERROR', message: 'Token expired' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Token expired');
        expect(result.value.errorCode).toBe('TOKEN_ERROR');
      }
    });

    it('returns failed ServiceFeedback with default message on HTTP 401 with JSON body but no message', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(401, {
          error: { code: 'AUTH_ERROR' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toContain('HTTP 401');
        expect(result.value.errorCode).toBe('AUTH_ERROR');
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
    it('returns error on OK response with invalid JSON', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, 'not valid json', {
          'Content-Type': 'text/plain',
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response');
      }
    });

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
          action: { id: 'action-abc', userId: 'user-xyz', text: 'Test issue text' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      const client = createClient();
      await client.processAction('action-abc', 'user-xyz', 'Test issue text');

      expect(scope.isDone()).toBe(true);
    });

    it('includes internal auth header', async () => {
      const customToken = 'custom-auth-token';
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', customToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
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
    it('handles special characters in text', async () => {
      const specialTitle = "Fix: API's \"broken\" feature <script>alert('xss')</script>";
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', text: specialTitle },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', specialTitle);

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles unicode characters in text', async () => {
      const unicodeTitle = '修复认证漏洞 🔒 Security fix';
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', text: unicodeTitle },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', unicodeTitle);

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty string text', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: { id: 'action-123', userId: 'user-456', text: '' },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'failed', message: 'Title is required', errorCode: 'VALIDATION_ERROR' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', '');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Title is required');
      }
    });

    it('handles very long text', async () => {
      const longTitle = 'A'.repeat(1000);
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
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
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      // Create client without logger to test default logger path
      const client = createLinearAgentHttpClient({ baseUrl, internalAuthToken });
      const result = await client.processAction('action-123', 'user-456', 'Test');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('includes summary in request body when provided', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', {
          action: {
            id: 'action-123',
            userId: 'user-456',
            text: 'Fix authentication bug',
            summary: 'Key points about the bug',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction(
        'action-123',
        'user-456',
        'Fix authentication bug',
        'Key points about the bug'
      );

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('excludes summary from request body when undefined', async () => {
      const scope = nock(baseUrl)
        .post('/internal/linear/process-action', (body) => {
          // Verify that summary is not present in the body
          return body.action && !Object.prototype.hasOwnProperty.call(body.action, 'summary');
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: { status: 'completed', message: 'Linear issue created: TEST-1' },
        });

      const client = createClient();
      const result = await client.processAction('action-123', 'user-456', 'Fix bug');

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });
});
