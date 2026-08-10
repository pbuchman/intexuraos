/**
 * Tests for internal API routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { err, ok } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import {
  FakeGoogleCalendarClient,
  FakeUserServiceClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
  FakeProcessedActionRepository,
  FakeCalendarPreviewRepository,
} from '../fakes.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeUserService: FakeUserServiceClient;
  let fakeCalendarClient: FakeGoogleCalendarClient;
  let fakeFailedEventRepository: FakeFailedEventRepository;
  let fakeCalendarActionExtractionService: FakeCalendarActionExtractionService;
  let fakeProcessedActionRepository: FakeProcessedActionRepository;
  let fakeCalendarPreviewRepository: FakeCalendarPreviewRepository;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'http://localhost:9999/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';

    fakeUserService = new FakeUserServiceClient();
    fakeCalendarClient = new FakeGoogleCalendarClient();
    fakeFailedEventRepository = new FakeFailedEventRepository();
    fakeCalendarActionExtractionService = new FakeCalendarActionExtractionService();
    fakeProcessedActionRepository = new FakeProcessedActionRepository();
    fakeCalendarPreviewRepository = new FakeCalendarPreviewRepository();

    setServices({
      userServiceClient: fakeUserService,
      googleCalendarClient: fakeCalendarClient,
      failedEventRepository: fakeFailedEventRepository,
      calendarActionExtractionService: fakeCalendarActionExtractionService,
      processedActionRepository: fakeProcessedActionRepository,
      calendarPreviewRepository: fakeCalendarPreviewRepository,
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /internal/calendar/events', () => {
    const validPayload = {
      userId: 'user-456',
      calendarId: 'primary',
      event: {
        summary: 'Dentist appointment',
        description: 'Annual checkup',
        location: 'Dental clinic',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        attendees: [{ email: 'assistant@example.com' }],
      },
    };

    it('creates an event through the internal service endpoint', async () => {
      fakeCalendarClient.setCreateResult(ok({
        id: 'calendar-event-123',
        summary: 'Dentist appointment',
        description: 'Annual checkup',
        location: 'Dental clinic',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        htmlLink: 'https://calendar.google.com/event?eid=calendar-event-123',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          event: {
            id: string;
            summary: string;
            htmlLink?: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.event).toMatchObject({
        id: 'calendar-event-123',
        summary: 'Dentist appointment',
        htmlLink: 'https://calendar.google.com/event?eid=calendar-event-123',
      });
    });

    it('omits htmlLink from direct create response when Google Calendar does not return it', async () => {
      fakeCalendarClient.setCreateResult(ok({
        id: 'calendar-event-no-link',
        summary: 'Dentist appointment',
        description: 'Annual checkup',
        location: 'Dental clinic',
        start: {
          dateTime: '2026-06-25T09:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
        end: {
          dateTime: '2026-06-25T10:00:00.000Z',
          timeZone: 'Europe/Warsaw',
        },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          event: {
            id: string;
            summary: string;
            htmlLink?: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.event).toMatchObject({
        id: 'calendar-event-no-link',
        summary: 'Dentist appointment',
      });
      expect(body.data.event.htmlLink).toBeUndefined();
    });

    it('creates an event with the primary calendar when calendarId is omitted', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-456',
          event: {
            summary: 'Dentist appointment',
            start: {
              dateTime: '2026-06-25T09:00:00.000Z',
            },
            end: {
              dateTime: '2026-06-25T10:00:00.000Z',
            },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          event: {
            summary: string;
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.event.summary).toBe('Dentist appointment');
    });

    it('returns 401 without internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 for invalid event payloads', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-456',
          event: {
            summary: 'Dentist appointment',
          },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('maps calendar domain failures through the shared error handler', async () => {
      fakeCalendarClient.setCreateResult(err({
        code: 'TOKEN_ERROR',
        message: 'OAuth token expired',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('OAuth token expired');
    });
  });

  describe('PATCH /internal/calendar/events/:eventId', () => {
    const validPayload = {
      userId: 'user-456',
      calendarId: 'primary',
      expectedEtag: '"event-bagrowa-v1"',
      attendeesToAdd: [{ email: 'new@example.com' }],
    };

    it('adds attendees while preserving the existing attendee metadata', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'owner@example.com');
      fakeCalendarClient.addEvent({
        id: 'event-bagrowa',
        etag: '"event-bagrowa-v1"',
        summary: 'Bagrowa',
        start: { dateTime: '2026-06-25T18:00:00+02:00' },
        end: { dateTime: '2026-06-25T20:30:00+02:00' },
        attendees: [
          {
            email: 'existing@example.com',
            displayName: 'Existing guest',
            responseStatus: 'accepted',
            optional: true,
          },
        ],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.event).toMatchObject({
        id: 'event-bagrowa',
        summary: 'Bagrowa',
        attendees: [
          {
            email: 'existing@example.com',
            displayName: 'Existing guest',
            responseStatus: 'accepted',
            optional: true,
          },
          { email: 'new@example.com' },
        ],
      });
      expect(fakeCalendarClient.updateEventCalls).toEqual([
        {
          accessToken: 'fake-google-token',
          calendarId: 'primary',
          eventId: 'event-bagrowa',
          updates: {
            attendees: [
              {
                email: 'existing@example.com',
                displayName: 'Existing guest',
                responseStatus: 'accepted',
                optional: true,
              },
              { email: 'new@example.com' },
            ],
          },
          options: { sendUpdates: 'all', expectedEtag: '"event-bagrowa-v1"' },
        },
      ]);
    });

    it('does not patch Google Calendar when the attendee already exists', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'owner@example.com');
      fakeCalendarClient.addEvent({
        id: 'event-bagrowa',
        etag: '"event-bagrowa-v1"',
        summary: 'Bagrowa',
        start: { dateTime: '2026-06-25T18:00:00+02:00' },
        end: { dateTime: '2026-06-25T20:30:00+02:00' },
        attendees: [{ email: 'New@Example.com', responseStatus: 'accepted' }],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.event.attendees).toEqual([
        { email: 'New@Example.com', responseStatus: 'accepted' },
      ]);
      expect(fakeCalendarClient.updateEventCalls).toEqual([]);
    });

    it('requires the exact calendar id from the confirmed snapshot', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: { ...validPayload, calendarId: undefined },
      });

      expect(response.statusCode).toBe(400);
      expect(fakeCalendarClient.updateEventCalls).toEqual([]);
    });

    it('returns 401 without internal auth', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it.each([
      { ...validPayload, attendeesToAdd: [] },
      { ...validPayload, attendeesToAdd: [{ email: 'not-an-email' }] },
      { calendarId: 'primary', attendeesToAdd: [{ email: 'new@example.com' }] },
    ])('returns 400 for an invalid attendee update payload', async (payload) => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('maps a missing event through the shared error handler', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'owner@example.com');

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/missing-event',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Event not found' },
      });
    });

    it('returns 409 without patching when the confirmed event version is stale', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'owner@example.com');
      fakeCalendarClient.addEvent({
        id: 'event-bagrowa',
        etag: '"event-bagrowa-v2"',
        summary: 'Bagrowa',
        start: { dateTime: '2026-06-25T18:00:00+02:00' },
        end: { dateTime: '2026-06-25T20:30:00+02:00' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/internal/calendar/events/event-bagrowa',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'Calendar event changed after confirmation; repeat the request',
        },
      });
      expect(fakeCalendarClient.updateEventCalls).toEqual([]);
    });
  });

  describe('POST /internal/calendar/events/query', () => {
    const validPayload = {
      userId: 'user-456',
      calendarId: 'primary',
      timeMin: '2026-06-29T00:00:00.000Z',
      timeMax: '2026-07-06T00:00:00.000Z',
      maxResults: 20,
      q: 'Dentist',
    };

    it('lists events through the internal service endpoint', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'user@example.com');
      fakeCalendarClient.addEvent({
        id: 'event-1',
        etag: '"event-1-v1"',
        summary: 'Dentist',
        start: { dateTime: '2026-06-30T09:00:00.000Z' },
        end: { dateTime: '2026-06-30T10:00:00.000Z' },
        description: 'Private notes',
        location: 'Dental clinic',
        attendees: [{ email: 'guest@example.com' }],
        organizer: { email: 'owner@example.com' },
        htmlLink: 'https://calendar.google.com/event?eid=event-1',
      });
      fakeCalendarClient.addEvent({
        id: 'event-2',
        summary: 'Focus block',
        start: { dateTime: '2026-07-01T09:00:00.000Z' },
        end: { dateTime: '2026-07-01T10:00:00.000Z' },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.events).toEqual([
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
      ]);
      expect(response.json().data.truncated).toBe(false);
      expect(fakeCalendarClient.listEventsCalls).toEqual([
        {
          accessToken: 'fake-google-token',
          calendarId: 'primary',
          options: {
            timeMin: '2026-06-29T00:00:00.000Z',
            timeMax: '2026-07-06T00:00:00.000Z',
            maxResults: 20,
            q: 'Dentist',
          },
        },
      ]);
    });

    it('lists primary calendar events with only required query fields', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'user@example.com');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'user-456',
          timeMin: '2026-06-29T00:00:00.000Z',
          timeMax: '2026-07-06T00:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.truncated).toBe(false);
      expect(fakeCalendarClient.listEventsCalls).toEqual([
        {
          accessToken: 'fake-google-token',
          calendarId: 'primary',
          options: {
            timeMin: '2026-06-29T00:00:00.000Z',
            timeMax: '2026-07-06T00:00:00.000Z',
          },
        },
      ]);
    });

    it('reports when another Google Calendar result page exists', async () => {
      fakeUserService.setTokenSuccess('fake-google-token', 'user@example.com');
      fakeCalendarClient.setListResult(ok({ events: [], truncated: true }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ events: [], truncated: true });
    });

    it('documents the downstream error response in OpenAPI', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      const spec = response.json() as {
        paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
      };
      expect(spec.paths['/internal/calendar/events/query']?.['post']?.responses).toHaveProperty('502');
    });

    it('returns 401 without internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when timeMax is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'user-456',
          calendarId: 'primary',
          timeMin: '2026-06-29T00:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when timeMax is not after timeMin', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: {
          userId: 'user-456',
          timeMin: '2026-07-06T00:00:00.000Z',
          timeMax: '2026-06-29T00:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 for downstream calendar list failures', async () => {
      fakeCalendarClient.setListResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Google Calendar unavailable',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/events/query',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(502);
      const body = response.json() as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Google Calendar unavailable');
    });
  });

  describe('POST /internal/calendar/process-action', () => {
    const validPayload = {
      action: {
        id: 'action-123',
        userId: 'user-456',
        title: 'Schedule a meeting tomorrow at 3pm',
      },
    };

    it('returns 401 without internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 for TOKEN_ERROR from use case', async () => {
      fakeCalendarClient.setCreateResult(err({
        code: 'TOKEN_ERROR',
        message: 'OAuth token expired',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('OAuth token expired');
    });

    it('returns 502 for downstream errors', async () => {
      fakeCalendarClient.setCreateResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Calendar creation failed',
      }));
      fakeFailedEventRepository.setCreateResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Something unexpected happened',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Something unexpected happened');
    });

    it('uses text field for extraction when provided', async () => {
      const fullPrompt = 'Set up a weekly standup every Monday at 9:15am starting next week';
      const payloadWithText = {
        action: {
          id: 'action-123',
          userId: 'user-456',
          title: 'Weekly standup',
        },
        text: fullPrompt,
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: payloadWithText,
      });

      expect(response.statusCode).toBe(200);
      // Verify the extraction service received the full text, not the short title
      expect(fakeCalendarActionExtractionService.extractEventCalls).toHaveLength(1);
      expect(fakeCalendarActionExtractionService.extractEventCalls[0]?.text).toBe(fullPrompt);
    });

    it('returns Google Calendar htmlLink as resourceUrl', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Team Meeting',
          start: '2025-01-15T14:00:00',
          end: '2025-01-15T15:00:00',
          location: 'Conference Room A',
          description: 'Weekly sync',
          valid: true,
          error: null,
          reasoning: 'Clear meeting request',
        },
      };
      fakeCalendarClient.setCreateResult(ok({
        id: 'calendar-event-with-link',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T14:00:00' },
        end: { dateTime: '2025-01-15T15:00:00' },
        htmlLink: 'https://calendar.google.com/event?eid=calendar-event-with-link',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('completed');
      expect(body.data.resourceUrl).toBe('https://calendar.google.com/event?eid=calendar-event-with-link');
    });

    it('omits resourceUrl when Google Calendar does not return htmlLink', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Team Meeting',
          start: '2025-01-15T14:00:00',
          end: '2025-01-15T15:00:00',
          location: 'Conference Room A',
          description: 'Weekly sync',
          valid: true,
          error: null,
          reasoning: 'Clear meeting request',
        },
      };
      fakeCalendarClient.setCreateResult(ok({
        id: 'calendar-event-without-link',
        summary: 'Team Meeting',
        start: { dateTime: '2025-01-15T14:00:00' },
        end: { dateTime: '2025-01-15T15:00:00' },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('completed');
      expect(body.data.resourceUrl).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('/#/calendar');
    });

    it('falls back to action.title when text field is not provided', async () => {
      const payloadWithoutText = {
        action: {
          id: 'action-123',
          userId: 'user-456',
          title: 'Schedule a meeting tomorrow at 3pm',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: payloadWithoutText,
      });

      expect(response.statusCode).toBe(200);
      expect(fakeCalendarActionExtractionService.extractEventCalls).toHaveLength(1);
      expect(fakeCalendarActionExtractionService.extractEventCalls[0]?.text).toBe('Schedule a meeting tomorrow at 3pm');
    });
  });

  describe('POST /internal/calendar/generate-preview', () => {
    const createPubSubPayload = (data: object): {
      message: { data: string; messageId: string; publishTime: string };
      subscription: string;
    } => ({
      message: {
        data: Buffer.from(JSON.stringify(data)).toString('base64'),
        messageId: 'msg-123',
        publishTime: '2025-01-15T10:00:00Z',
      },
      subscription: 'projects/test/subscriptions/calendar-event-preview-generate',
    });

    it('generates preview successfully from valid Pub/Sub message', async () => {
      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Lunch with Monika tomorrow at 2pm',
        currentDate: '2025-01-14',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: { from: 'noreply@google.com' },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { previewId: string; status: string } };
      expect(body.success).toBe(true);
      expect(body.data.previewId).toBe('action-123');
      expect(body.data.status).toBe('ready');
    });

    it('returns 400 for invalid base64 message', async () => {
      const payload = {
        message: {
          data: 'not-valid-base64!!!',
          messageId: 'msg-123',
          publishTime: '2025-01-15T10:00:00Z',
        },
        subscription: 'projects/test/subscriptions/calendar-event-preview-generate',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: { from: 'noreply@google.com' },
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 for invalid JSON in message', async () => {
      const payload = {
        message: {
          data: Buffer.from('not json').toString('base64'),
          messageId: 'msg-123',
          publishTime: '2025-01-15T10:00:00Z',
        },
        subscription: 'projects/test/subscriptions/calendar-event-preview-generate',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: { from: 'noreply@google.com' },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });

    it('handles extraction failure gracefully', async () => {
      fakeCalendarActionExtractionService.extractEventResult = err({
        code: 'NO_API_KEY',
        message: 'User has no API key configured',
      });

      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Meeting tomorrow',
        currentDate: '2025-01-14',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: { from: 'noreply@google.com' },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { previewId: string; status: string } };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
    });

    it('returns 401 without auth for direct service call', async () => {
      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Meeting tomorrow',
        currentDate: '2025-01-14',
      });

      // Direct call without Pub/Sub header or internal auth token
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        payload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('allows Pub/Sub push with from: noreply@google.com header', async () => {
      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Lunch with Monika tomorrow at 2pm',
        currentDate: '2025-01-14',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: {
          from: 'noreply@google.com',
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('allows direct service call with internal auth token', async () => {
      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Lunch with Monika tomorrow at 2pm',
        currentDate: '2025-01-14',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 502 when generateCalendarPreview returns an error', async () => {
      fakeCalendarPreviewRepository.setGetByActionIdResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore unavailable',
      }));

      const payload = createPubSubPayload({
        actionId: 'action-123',
        userId: 'user-456',
        text: 'Meeting tomorrow',
        currentDate: '2025-01-14',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
        headers: { from: 'noreply@google.com' },
        payload,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Firestore unavailable');
    });
  });

  describe('GET /internal/calendar/preview/:actionId', () => {
    it('returns 401 without internal auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/calendar/preview/action-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns null when preview does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/calendar/preview/non-existent',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { preview: null } };
      expect(body.success).toBe(true);
      expect(body.data.preview).toBeNull();
    });

    it('returns preview when it exists', async () => {
      fakeCalendarPreviewRepository.seedPreview({
        actionId: 'action-123',
        userId: 'user-456',
        status: 'ready',
        summary: 'Lunch with Monika',
        start: '2025-01-15T14:00:00',
        end: '2025-01-15T15:00:00',
        location: 'Restaurant',
        duration: '1 hour',
        isAllDay: false,
        generatedAt: '2025-01-14T10:00:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/internal/calendar/preview/action-123',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { preview: { actionId: string; status: string; summary: string } } };
      expect(body.success).toBe(true);
      expect(body.data.preview.actionId).toBe('action-123');
      expect(body.data.preview.status).toBe('ready');
      expect(body.data.preview.summary).toBe('Lunch with Monika');
    });

    it('returns 502 when repository fails', async () => {
      fakeCalendarPreviewRepository.setGetByActionIdResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore unavailable',
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/internal/calendar/preview/action-123',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('POST /internal/calendar/preview (direct HTTP)', () => {
    const validPayload = {
      actionId: 'action-123',
      userId: 'user-456',
      text: 'Lunch with Monika tomorrow at 2pm',
      currentDate: '2025-01-14',
    };

    it('generates preview successfully with valid input', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/preview',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { preview: { actionId: string; status: string; summary: string } } };
      expect(body.success).toBe(true);
      expect(body.data.preview.actionId).toBe('action-123');
      expect(body.data.preview.status).toBe('ready');
    });

    it('returns 401 without internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/preview',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 400 for invalid body (missing required fields)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/preview',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: { actionId: 'action-123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('handles extraction failure gracefully (returns failed preview)', async () => {
      fakeCalendarActionExtractionService.extractEventResult = err({
        code: 'NO_API_KEY',
        message: 'User has no API key configured',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/preview',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { preview: { status: string } } };
      expect(body.success).toBe(true);
      expect(body.data.preview.status).toBe('failed');
    });

    it('returns 502 when generateCalendarPreview returns an error', async () => {
      fakeCalendarPreviewRepository.setGetByActionIdResult(err({
        code: 'INTERNAL_ERROR',
        message: 'Firestore unavailable',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/preview',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      expect(body.error.message).toBe('Firestore unavailable');
    });
  });
});
