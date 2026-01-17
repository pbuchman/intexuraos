import { describe, it, expect, beforeEach } from 'vitest';
import { isOk, isErr } from '@intexuraos/common-core';
import nock from 'nock';
import { createCalendarServiceHttpClient } from '../../../infra/http/calendarServiceHttpClient.js';
import type { CalendarServiceClient } from '../../../domain/ports/calendarServiceClient.js';
import type { Action } from '../../../domain/models/action.js';
import pino from 'pino';

const silentLogger = pino({ level: 'silent' });

const baseUrl = 'http://calendar-agent.test';
const internalAuthToken = 'test-internal-token';

// Helper to create a test action
const createTestAction = (overrides?: Partial<Action>): Action => ({
  id: 'action-123',
  userId: 'user-456',
  commandId: 'cmd-789',
  type: 'calendar',
  confidence: 1,
  title: 'Meeting at 3pm',
  status: 'pending',
  payload: {},
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:00:00Z',
  ...overrides,
});

describe('calendarServiceHttpClient', () => {
  beforeEach(() => {
    nock.cleanAll();
  });

  const createClient = (): CalendarServiceClient =>
    createCalendarServiceHttpClient({
      baseUrl,
      internalAuthToken,
      logger: silentLogger,
    });

  describe('successful responses', () => {
    it('returns completed status with resourceUrl', async () => {
      const action = createTestAction({ title: 'Meeting at 3pm' });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action', {
          action: {
            id: 'action-123',
            userId: 'user-456',
            commandId: 'cmd-789',
            type: 'calendar',
            confidence: 1,
            title: 'Meeting at 3pm',
            status: 'pending',
            payload: {},
            createdAt: '2025-01-15T10:00:00Z',
            updatedAt: '2025-01-15T10:00:00Z',
          },
        })
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created successfully',
            resourceUrl: 'https://calendar.google.com/event/abc123',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Calendar event created successfully');
        expect(result.value.resourceUrl).toBe('https://calendar.google.com/event/abc123');
      }
    });

    it('returns failed status with error message and errorCode', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Invalid calendar event format',
            errorCode: 'VALIDATION_ERROR',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid calendar event format');
        expect(result.value.errorCode).toBe('VALIDATION_ERROR');
      }
    });

    it('returns completed status without resourceUrl', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('completed');
        expect(result.value.resourceUrl).toBeUndefined();
      }
    });
  });

  describe('HTTP error responses', () => {
    it('returns error for 401 Unauthorized', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(401, 'Unauthorized');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 401');
      }
    });

    it('returns error for 403 Forbidden', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(403, 'Forbidden');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 403');
      }
    });

    it('returns error for 404 Not Found', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(404, 'Not Found');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 404');
      }
    });

    it('returns error for 500 Internal Server Error', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(500, 'Internal Server Error');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 500');
      }
    });

    it('returns error for 502 Bad Gateway', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(502, 'Bad Gateway');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 502');
      }
    });

    it('returns error for 503 Service Unavailable', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(503, 'Service Unavailable');

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('HTTP 503');
      }
    });
  });

  describe('response validation errors', () => {
    it('returns error when status is missing', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          resourceUrl: 'https://calendar.example.com/123',
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response from calendar-agent');
      }
    });

    it('returns error when status is invalid', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          status: 'unknown',
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response from calendar-agent');
      }
    });

    it('returns error when response is empty object', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {});

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response from calendar-agent');
      }
    });

    it('returns error when response is array instead of object', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, []);

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Invalid response from calendar-agent');
      }
    });
  });

  describe('network failures', () => {
    it('returns error on network connection failure', async () => {
      const action = createTestAction();
      nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ECONNREFUSED', message: 'Connection refused' });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call calendar-agent');
        expect(result.error.message).toContain('Connection refused');
      }
    });

    it('returns error on DNS resolution failure', async () => {
      const action = createTestAction();
      nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call calendar-agent');
        expect(result.error.message).toContain('getaddrinfo ENOTFOUND');
      }
    });

    it('returns error on timeout', async () => {
      const action = createTestAction();
      nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .replyWithError({ name: 'AbortError', message: 'The operation was aborted' });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.message).toContain('Failed to call calendar-agent');
        expect(result.error.message).toContain('aborted');
      }
    });
  });

  describe('request structure', () => {
    it('sends correct request body structure', async () => {
      const action = createTestAction({
        id: 'action-abc',
        userId: 'user-xyz',
        title: 'Team standup',
      });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .matchHeader('Content-Type', 'application/json')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createClient();
      await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
    });

    it('includes internal auth header', async () => {
      const action = createTestAction();
      const customToken = 'custom-auth-token';
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', customToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createCalendarServiceHttpClient({
        baseUrl,
        internalAuthToken: customToken,
        logger: silentLogger,
      });
      await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
    });
  });

  describe('special characters in input', () => {
    it('handles special characters in title', async () => {
      const specialTitle = "Meeting: discuss \"project X\" & review <notes>";
      const action = createTestAction({ title: specialTitle });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('handles unicode characters in title', async () => {
      const unicodeTitle = '团队会议 📅 Team meeting';
      const action = createTestAction({ title: unicodeTitle });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles empty string title', async () => {
      const action = createTestAction({ title: '' });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Title is required',
            errorCode: 'VALIDATION_ERROR',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Title is required');
      }
    });

    it('handles very long title', async () => {
      const longTitle = 'A'.repeat(1000);
      const action = createTestAction({ title: longTitle });
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createClient();
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });

    it('uses default logger when none provided', async () => {
      const action = createTestAction();
      const scope = nock(baseUrl)
        .post('/internal/calendar/process-action')
        .matchHeader('X-Internal-Auth', internalAuthToken)
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Calendar event created',
            resourceUrl: 'https://calendar.example.com/123',
          },
        });

      const client = createCalendarServiceHttpClient({ baseUrl, internalAuthToken });
      const result = await client.processAction({ action });

      expect(scope.isDone()).toBe(true);
      expect(isOk(result)).toBe(true);
    });
  });
});
