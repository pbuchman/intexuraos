import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarAgentServiceClient } from '../client.js';
import type { CalendarAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://calendar-agent.test';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as CalendarAgentServiceConfig['logger'];

beforeEach(() => {
  nock.cleanAll();
  vi.clearAllMocks();
});

afterEach(() => {
  nock.cleanAll();
});

describe('createCalendarAgentServiceClient', () => {
  it('creates calendar events through the internal endpoint', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/events', {
        userId: 'user-1',
        calendarId: 'primary',
        event: {
          summary: 'Dentist appointment',
          start: {
            dateTime: '2026-06-25T09:00:00.000Z',
            timeZone: 'Europe/Warsaw',
          },
          end: {
            dateTime: '2026-06-25T10:00:00.000Z',
            timeZone: 'Europe/Warsaw',
          },
          location: 'Dental clinic',
        },
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(201, {
        success: true,
        data: {
          event: {
            id: 'calendar-event-123',
            summary: 'Dentist appointment',
            start: {
              dateTime: '2026-06-25T09:00:00.000Z',
              timeZone: 'Europe/Warsaw',
            },
            end: {
              dateTime: '2026-06-25T10:00:00.000Z',
              timeZone: 'Europe/Warsaw',
            },
            location: 'Dental clinic',
            htmlLink: 'https://calendar.google.com/event?eid=calendar-event-123',
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      calendarId: 'primary',
      event: {
        summary: 'Dentist appointment',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        location: 'Dental clinic',
      },
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'calendar-event-123',
        summary: 'Dentist appointment',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        location: 'Dental clinic',
        htmlLink: 'https://calendar.google.com/event?eid=calendar-event-123',
      },
    });
  });

  it('maps all optional fields from created calendar events', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/events')
      .reply(201, {
        success: true,
        data: {
          event: {
            id: 'calendar-event-full',
            summary: 'Strategy review',
            description: 'Quarterly planning',
            location: 'Conference room',
            start: {
              dateTime: '2026-06-25T09:00:00.000Z',
            },
            end: {
              dateTime: '2026-06-25T10:00:00.000Z',
            },
            status: 'confirmed',
            htmlLink: 'https://calendar.google.com/event?eid=calendar-event-full',
            created: '2026-06-24T10:00:00.000Z',
            updated: '2026-06-24T10:01:00.000Z',
            organizer: {
              email: 'owner@example.com',
            },
            attendees: [{ email: 'assistant@example.com' }],
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      event: {
        summary: 'Strategy review',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
      },
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'calendar-event-full',
        summary: 'Strategy review',
        description: 'Quarterly planning',
        location: 'Conference room',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/event?eid=calendar-event-full',
        created: '2026-06-24T10:00:00.000Z',
        updated: '2026-06-24T10:01:00.000Z',
        organizer: {
          email: 'owner@example.com',
        },
        attendees: [{ email: 'assistant@example.com' }],
      },
    });
  });

  it('maps minimal created calendar events without optional fields', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/events')
      .reply(201, {
        success: true,
        data: {
          event: {
            id: 'calendar-event-minimal',
            summary: 'Strategy review',
            start: {
              dateTime: '2026-06-25T09:00:00.000Z',
            },
            end: {
              dateTime: '2026-06-25T10:00:00.000Z',
            },
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      event: {
        summary: 'Strategy review',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'calendar-event-minimal',
        summary: 'Strategy review',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
      },
    });
  });

  it('returns invalid response errors for malformed create envelopes', async () => {
    nock(BASE_URL).post('/internal/calendar/events').reply(200, {
      success: true,
    });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      event: {
        summary: 'Strategy review',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid response from calendar-agent'),
    });
  });

  it('returns calendar create envelope error messages from success=false responses', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/events')
      .reply(200, {
        success: false,
        error: {
          message: 'Calendar validation failed',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      event: {
        summary: 'Strategy review',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Calendar validation failed'),
    });
  });

  it('returns calendar create error messages from non-2xx envelopes', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/events')
      .reply(401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'OAuth token expired',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.createEvent({
      userId: 'user-1',
      event: {
        summary: 'Dentist appointment',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('OAuth token expired');
    }
  });

  it('returns service feedback on process success', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/process-action', {
        action: {
          id: 'action-1',
          userId: 'user-1',
          title: 'Meeting',
        },
        text: 'Meeting',
      })
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Calendar event created',
          resourceUrl: 'https://calendar.google.com/event/abc',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction({
      action: {
        id: 'action-1',
        userId: 'user-1',
        title: 'Meeting',
      },
      text: 'Meeting',
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Calendar event created',
        resourceUrl: 'https://calendar.google.com/event/abc',
      },
    });
  });

  it('maps non-2xx JSON process errors into failed service feedback', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/process-action')
      .reply(401, {
        success: false,
        error: {
          code: 'TOKEN_ERROR',
          message: 'Token expired',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction({
      action: {
        id: 'action-1',
        userId: 'user-1',
        title: 'Meeting',
      },
      text: 'Meeting',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 'failed',
        message: 'Token expired',
        errorCode: 'TOKEN_ERROR',
      },
    });
  });

  it('forwards request ids and explicit timeouts for processAction', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/process-action')
      .matchHeader('x-request-id', 'req-123')
      .reply(200, {
        success: true,
        data: {
          status: 'completed',
          message: 'Calendar event created',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.processAction(
      {
        action: {
          id: 'action-1',
          userId: 'user-1',
          title: 'Meeting',
        },
        text: 'Meeting',
      },
      { requestId: 'req-123', timeoutMs: 5000 }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 'completed',
        message: 'Calendar event created',
      },
    });
  });

  it('returns preview data on preview success', async () => {
    const scope = nock(BASE_URL)
      .get('/internal/calendar/preview/action-1')
      .matchHeader('x-internal-auth', 'secret')
      .reply(200, {
        success: true,
        data: {
          preview: {
            actionId: 'action-1',
            userId: 'user-1',
            status: 'ready',
            summary: 'Tomorrow at noon',
            generatedAt: '2026-01-01T12:00:00.000Z',
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPreview('action-1');

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        actionId: 'action-1',
        userId: 'user-1',
        status: 'ready',
        summary: 'Tomorrow at noon',
        generatedAt: '2026-01-01T12:00:00.000Z',
      },
    });
  });

  it('returns null when no calendar preview exists', async () => {
    nock(BASE_URL)
      .get('/internal/calendar/preview/action-none')
      .reply(200, {
        success: true,
        data: {
          preview: null,
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPreview('action-none');

    expect(result).toEqual({
      ok: true,
      value: null,
    });
  });

  it('maps minimal calendar previews without optional fields', async () => {
    nock(BASE_URL)
      .get('/internal/calendar/preview/action-minimal')
      .reply(200, {
        success: true,
        data: {
          preview: {
            actionId: 'action-minimal',
            userId: 'user-1',
            status: 'pending',
            generatedAt: '2026-01-01T12:00:00.000Z',
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPreview('action-minimal');

    expect(result).toEqual({
      ok: true,
      value: {
        actionId: 'action-minimal',
        userId: 'user-1',
        status: 'pending',
        generatedAt: '2026-01-01T12:00:00.000Z',
      },
    });
  });

  it('maps all optional calendar preview fields when present', async () => {
    nock(BASE_URL)
      .get('/internal/calendar/preview/action-full')
      .reply(200, {
        success: true,
        data: {
          preview: {
            actionId: 'action-full',
            userId: 'user-1',
            status: 'ready',
            generatedAt: '2026-01-01T12:00:00.000Z',
            summary: 'Tomorrow at noon',
            start: '2026-01-02T12:00:00.000Z',
            end: '2026-01-02T13:00:00.000Z',
            location: 'Office',
            description: 'Planning',
            duration: 60,
            isAllDay: false,
            error: 'none',
            reasoning: 'calendar context',
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.getPreview('action-full');

    expect(result).toEqual({
      ok: true,
      value: {
        actionId: 'action-full',
        userId: 'user-1',
        status: 'ready',
        generatedAt: '2026-01-01T12:00:00.000Z',
        summary: 'Tomorrow at noon',
        start: '2026-01-02T12:00:00.000Z',
        end: '2026-01-02T13:00:00.000Z',
        location: 'Office',
        description: 'Planning',
        duration: 60,
        isAllDay: false,
        error: 'none',
        reasoning: 'calendar context',
      },
    });
  });

  it('returns preview error messages on generate-preview http failures', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/preview')
      .reply(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Preview not found',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Preview not found');
    }
  });

  it('falls back to the HTTP status text when preview errors lack an envelope body', async () => {
    nock(BASE_URL).post('/internal/calendar/preview').reply(500, 'server exploded');

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('HTTP 500: Internal Server Error'),
    });
  });

  it('falls back to the HTTP status text when the preview error body incorrectly claims success', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/preview')
      .reply(500, {
        success: true,
        data: {
          preview: null,
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.generatePreview({
      actionId: 'action-1',
      userId: 'user-1',
      text: 'Meeting',
      currentDate: '2026-01-01T12:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('HTTP 500: Internal Server Error'),
    });
  });

  it('uses default timeout for preview requests when configured', async () => {
    nock(BASE_URL)
      .get('/internal/calendar/preview/action-timeout')
      .delay(50)
      .reply(200, {
        success: true,
        data: {
          preview: null,
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.getPreview('action-timeout');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Failed to fetch calendar preview: Request exceeded 1ms');
    }
  });
});
