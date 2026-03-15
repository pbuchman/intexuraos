import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { createCalendarServiceHttpClient } from './calendarServiceHttpClient.js';
import type { CalendarServiceHttpClientConfig } from './calendarServiceHttpClient.js';
import type { Action } from '../../domain/models/action.js';

const BASE_URL = 'http://calendar-test:9999';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createConfig(): CalendarServiceHttpClientConfig {
  return {
    baseUrl: BASE_URL,
    internalAuthToken: 'test-auth-token',
    logger: fakeLogger,
  };
}

function createAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'action-1',
    userId: 'user-1',
    commandId: 'cmd-1',
    type: 'calendar',
    confidence: 0.95,
    title: 'Test Calendar Event',
    status: 'pending',
    payload: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('calendarServiceHttpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('processAction', () => {
    it('returns success with all fields including resourceUrl', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Event created',
            resourceUrl: 'https://calendar.google.com/event/123',
          },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting tomorrow',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Event created');
        expect(result.value.resourceUrl).toBe('https://calendar.google.com/event/123');
      }
      scope.done();
    });

    it('returns success without resourceUrl', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(200, {
          success: true,
          data: {
            status: 'completed',
            message: 'Event created',
          },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('completed');
        expect(result.value.message).toBe('Event created');
        expect(result.value.resourceUrl).toBeUndefined();
      }
      scope.done();
    });

    it('returns error on fetch network error', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .replyWithError('Connection refused');

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to call calendar-agent');
      }
      scope.done();
    });

    it('returns error on non-JSON error response', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(500, 'Internal Server Error', { 'Content-Type': 'text/plain' });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('HTTP 500');
      }
      scope.done();
    });

    it('returns error on non-JSON OK response', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(200, 'not json', { 'Content-Type': 'text/plain' });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid response from calendar-agent');
      }
      scope.done();
    });

    it('returns failed feedback on JSON error response (not ok)', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(400, {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid event data' },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toBe('Invalid event data');
        expect(result.value.errorCode).toBe('VALIDATION_ERROR');
      }
      scope.done();
    });

    it('returns error on invalid success response (success: false, no data)', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(200, {
          success: false,
          error: { code: 'UNKNOWN', message: 'Something went wrong' },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Something went wrong');
      }
      scope.done();
    });

    it('returns success with errorCode when data includes it', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(200, {
          success: true,
          data: {
            status: 'failed',
            message: 'Calendar API error',
            errorCode: 'CALENDAR_API_ERROR',
          },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.errorCode).toBe('CALENDAR_API_ERROR');
      }
      scope.done();
    });

    it('falls back to HTTP status message when error response has no error.message', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/process-action')
        .reply(502, {
          success: false,
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.processAction({
        action: createAction(),
        text: 'Create a meeting',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('failed');
        expect(result.value.message).toContain('HTTP 502');
      }
      scope.done();
    });
  });

  describe('getPreview', () => {
    it('returns preview on success', async () => {
      const preview = {
        actionId: 'action-1',
        userId: 'user-1',
        status: 'ready' as const,
        summary: 'Team standup',
        start: '2026-01-02T10:00:00Z',
        end: '2026-01-02T10:30:00Z',
        generatedAt: '2026-01-01T12:00:00Z',
      };

      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .reply(200, {
          success: true,
          data: { preview },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(preview);
      }
      scope.done();
    });

    it('returns null preview on success with null data', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .reply(200, {
          success: true,
          data: { preview: null },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeNull();
      }
      scope.done();
    });

    it('returns error with fallback HTTP status when error response has no error.message', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .reply(503, {
          success: false,
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('HTTP 503');
      }
      scope.done();
    });

    it('returns error with error.message when error response includes it', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .reply(500, {
          success: false,
          error: { code: 'INTERNAL', message: 'Preview generation failed' },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Preview generation failed');
      }
      scope.done();
    });

    it('returns error on invalid response (success false, no data)', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .reply(200, {
          success: false,
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Invalid response from calendar-agent');
      }
      scope.done();
    });

    it('returns error on network failure', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/calendar/preview/action-1')
        .replyWithError('ECONNREFUSED');

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.getPreview('action-1');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to fetch calendar preview');
      }
      scope.done();
    });
  });

  describe('generatePreview', () => {
    const generateRequest = {
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Schedule a meeting tomorrow at 2pm',
      currentDate: '2026-01-01T00:00:00.000Z',
    };

    it('returns preview on success', async () => {
      const preview = {
        actionId: 'action-1',
        userId: 'user-1',
        status: 'ready' as const,
        summary: 'Meeting',
        start: '2026-01-02T14:00:00Z',
        generatedAt: '2026-01-01T12:00:00Z',
      };

      const scope = nock(BASE_URL)
        .post('/internal/calendar/preview')
        .reply(200, {
          success: true,
          data: { preview },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.generatePreview(generateRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(preview);
      }
      scope.done();
    });

    it('returns error with fallback HTTP status when error response has no error.message', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/preview')
        .reply(500, {
          success: false,
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.generatePreview(generateRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('HTTP 500');
      }
      scope.done();
    });

    it('returns error with error.message when error response includes it', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/preview')
        .reply(400, {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Missing required fields' },
        });

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.generatePreview(generateRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Missing required fields');
      }
      scope.done();
    });

    it('returns error on network failure', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/calendar/preview')
        .replyWithError('ECONNREFUSED');

      const client = createCalendarServiceHttpClient(createConfig());
      const result = await client.generatePreview(generateRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to generate calendar preview');
      }
      scope.done();
    });
  });
});
