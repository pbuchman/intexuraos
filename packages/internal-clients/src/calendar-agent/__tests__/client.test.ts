import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarAgentServiceClient } from '../client.js';
import type { CalendarAgentServiceConfig } from '../types.js';

const BASE_URL = 'http://calendar-agent.test';

const attendeeUpdateSnapshot = {
  calendarId: 'primary',
  expectedEtag: '"event-1-v1"',
};

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

  it('updates event attendees through the encoded internal endpoint and maps the full event', async () => {
    const scope = nock(BASE_URL)
      .patch('/internal/calendar/events/event%2Fwith%20spaces%3F', {
        userId: 'user-1',
        ...attendeeUpdateSnapshot,
        changes: {
          attendeesToAdd: [{ email: 'karol@example.com' }, { email: 'anna@example.com' }],
        },
      })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('x-request-id', 'req-update-123')
      .delay(25)
      .reply(200, {
        success: true,
        data: {
          event: {
            id: 'event/with spaces?',
            summary: 'Karol na Bagrowej',
            description: 'Wieczorne spotkanie',
            location: 'Bagrowa',
            start: {
              dateTime: '2026-08-11T18:00:00+02:00',
              timeZone: 'Europe/Warsaw',
            },
            end: {
              dateTime: '2026-08-11T19:00:00+02:00',
              timeZone: 'Europe/Warsaw',
            },
            status: 'confirmed',
            htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
            created: '2026-08-10T08:00:00.000Z',
            updated: '2026-08-10T08:30:00.000Z',
            organizer: {
              email: 'owner@example.com',
              displayName: 'Owner',
              self: true,
            },
            attendees: [
              {
                email: 'karol@example.com',
                displayName: 'Karol',
                self: false,
                responseStatus: 'needsAction',
                optional: false,
              },
              {
                email: 'anna@example.com',
                responseStatus: 'accepted',
              },
            ],
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.updateEventAttendees(
      {
        eventId: 'event/with spaces?',
        userId: 'user-1',
        ...attendeeUpdateSnapshot,
        attendeesToAdd: [{ email: 'karol@example.com' }, { email: 'anna@example.com' }],
      },
      { requestId: 'req-update-123' }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'event/with spaces?',
        summary: 'Karol na Bagrowej',
        description: 'Wieczorne spotkanie',
        location: 'Bagrowa',
        start: {
          dateTime: '2026-08-11T18:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-08-11T19:00:00+02:00',
          timeZone: 'Europe/Warsaw',
        },
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=event-1',
        created: '2026-08-10T08:00:00.000Z',
        updated: '2026-08-10T08:30:00.000Z',
        organizer: {
          email: 'owner@example.com',
          displayName: 'Owner',
          self: true,
        },
        attendees: [
          {
            email: 'karol@example.com',
            displayName: 'Karol',
            self: false,
            responseStatus: 'needsAction',
            optional: false,
          },
          {
            email: 'anna@example.com',
            responseStatus: 'accepted',
          },
        ],
      },
    });
  });

  it('updates general calendar event fields through the singular patch endpoint', async () => {
    const scope = nock(BASE_URL)
      .patch('/internal/calendar/events/event-photos', {
        userId: 'user-1',
        calendarId: 'primary',
        expectedEtag: '"event-photos-v1"',
        changes: {
          summary: 'Google Photos archive',
          start: { date: '2026-08-22' },
          end: { date: '2026-08-23' },
        },
      })
      .reply(200, {
        success: true,
        data: {
          event: {
            id: 'event-photos',
            summary: 'Google Photos archive',
            start: { date: '2026-08-22' },
            end: { date: '2026-08-23' },
          },
        },
      });
    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.updateEvent({
      eventId: 'event-photos',
      userId: 'user-1',
      calendarId: 'primary',
      expectedEtag: '"event-photos-v1"',
      changes: {
        summary: 'Google Photos archive',
        start: { date: '2026-08-22' },
        end: { date: '2026-08-23' },
      },
    });

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'event-photos',
        summary: 'Google Photos archive',
        start: { date: '2026-08-22' },
        end: { date: '2026-08-23' },
      },
    });
  });

  it('returns general calendar event update errors from the singular patch endpoint', async () => {
    nock(BASE_URL)
      .patch('/internal/calendar/events/event-photos')
      .reply(503, {
        success: false,
        error: { message: 'Google Calendar unavailable' },
      });
    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });

    const result = await client.updateEvent({
      eventId: 'event-photos',
      userId: 'user-1',
      calendarId: 'primary',
      expectedEtag: '"event-photos-v1"',
      changes: { summary: 'Renamed' },
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Google Calendar unavailable'),
    });
  });

  it('returns calendar attendee update messages from non-2xx envelopes', async () => {
    nock(BASE_URL)
      .patch('/internal/calendar/events/event-404')
      .reply(404, {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Calendar event not found',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateEventAttendees({
      eventId: 'event-404',
      userId: 'user-1',
      ...attendeeUpdateSnapshot,
      attendeesToAdd: [{ email: 'karol@example.com' }],
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Calendar event not found'),
    });
  });

  it('preserves the conflict code for a stale calendar confirmation', async () => {
    nock(BASE_URL)
      .patch('/internal/calendar/events/event-stale')
      .reply(409, {
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Calendar event changed after confirmation; repeat the request',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateEventAttendees({
      eventId: 'event-stale',
      userId: 'user-1',
      ...attendeeUpdateSnapshot,
      attendeesToAdd: [{ email: 'karol@example.com' }],
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('CONFLICT: Calendar event changed after confirmation; repeat the request'),
    });
  });

  it('returns calendar attendee update messages from success=false envelopes', async () => {
    nock(BASE_URL)
      .patch('/internal/calendar/events/event-1')
      .reply(200, {
        success: false,
        error: {
          message: 'Attendee cannot be invited',
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateEventAttendees({
      eventId: 'event-1',
      userId: 'user-1',
      ...attendeeUpdateSnapshot,
      attendeesToAdd: [{ email: 'karol@example.com' }],
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Attendee cannot be invited'),
    });
  });

  it('returns invalid response errors for malformed attendee update envelopes', async () => {
    nock(BASE_URL).patch('/internal/calendar/events/event-1').reply(200, {
      success: true,
    });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateEventAttendees({
      eventId: 'event-1',
      userId: 'user-1',
      ...attendeeUpdateSnapshot,
      attendeesToAdd: [{ email: 'karol@example.com' }],
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid response from calendar-agent'),
    });
  });

  it('forwards explicit attendee update timeouts', async () => {
    nock(BASE_URL)
      .patch('/internal/calendar/events/event-timeout')
      .delay(50)
      .reply(200, {
        success: true,
        data: {
          event: {
            id: 'event-timeout',
            summary: 'Meeting',
            start: { dateTime: '2026-08-11T18:00:00+02:00' },
            end: { dateTime: '2026-08-11T19:00:00+02:00' },
          },
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.updateEventAttendees(
      {
        eventId: 'event-timeout',
        userId: 'user-1',
        ...attendeeUpdateSnapshot,
        attendeesToAdd: [{ email: 'karol@example.com' }],
      },
      { timeoutMs: 1 }
    );

    expect(result).toEqual({
      ok: false,
      error: new Error('Failed to update calendar event attendees: Request exceeded 1ms'),
    });
  });

  it('lists calendar events through the internal query endpoint', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/calendar/events/query', {
        userId: 'user-1',
        timeMin: '2026-06-29T00:00:00.000Z',
        timeMax: '2026-07-06T00:00:00.000Z',
        q: 'Dentist',
        maxResults: 20,
      })
      .matchHeader('x-internal-auth', 'secret')
      .matchHeader('x-request-id', 'req-list-123')
      .delay(25)
      .reply(200, {
        success: true,
        data: {
          truncated: true,
          events: [
            {
              id: 'event-1',
              etag: '"event-1-v1"',
              summary: 'Dentist',
              start: { dateTime: '2026-06-30T09:00:00.000Z' },
              end: { dateTime: '2026-06-30T10:00:00.000Z' },
              location: 'Dental clinic',
              htmlLink: 'https://calendar.google.com/event?eid=event-1',
            },
            {
              id: 'event-2',
              summary: 'Focus block',
              start: { dateTime: '2026-07-01T09:00:00.000Z' },
              end: { dateTime: '2026-07-01T10:00:00.000Z' },
            },
          ],
        },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
      defaultTimeoutMs: 1,
    });
    const result = await client.listEvents(
      {
        userId: 'user-1',
        timeMin: '2026-06-29T00:00:00.000Z',
        timeMax: '2026-07-06T00:00:00.000Z',
        q: 'Dentist',
        maxResults: 20,
      },
      { requestId: 'req-list-123' }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({
      ok: true,
      value: {
        truncated: true,
        events: [
          {
            id: 'event-1',
            etag: '"event-1-v1"',
            summary: 'Dentist',
            start: { dateTime: '2026-06-30T09:00:00.000Z' },
            end: { dateTime: '2026-06-30T10:00:00.000Z' },
            location: 'Dental clinic',
            htmlLink: 'https://calendar.google.com/event?eid=event-1',
          },
          {
            id: 'event-2',
            summary: 'Focus block',
            start: { dateTime: '2026-07-01T09:00:00.000Z' },
            end: { dateTime: '2026-07-01T10:00:00.000Z' },
          },
        ],
      },
    });
  });

  it('returns invalid response errors for malformed list envelopes', async () => {
    nock(BASE_URL).post('/internal/calendar/events/query').reply(200, {
      success: true,
    });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.listEvents({
      userId: 'user-1',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid response from calendar-agent'),
    });
  });

  it('returns an invalid response error when a list response omits pagination metadata', async () => {
    nock(BASE_URL)
      .post('/internal/calendar/events/query')
      .reply(200, {
        success: true,
        data: { events: [] },
      });

    const client = createCalendarAgentServiceClient({
      baseUrl: BASE_URL,
      internalAuthToken: 'secret',
      logger,
    });
    const result = await client.listEvents({
      userId: 'user-1',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
    });

    expect(result).toEqual({
      ok: false,
      error: new Error('Invalid response from calendar-agent'),
    });
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
