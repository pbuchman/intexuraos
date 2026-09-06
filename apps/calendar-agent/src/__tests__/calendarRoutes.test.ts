/**
 * Tests for calendar API routes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { err, ok } from '@intexuraos/common-core';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeGoogleCalendarClient,
  FakeUserServiceClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
  FakeProcessedActionRepository,
  FakeCalendarPreviewRepository,
} from './fakes.js';
import type { CalendarEvent, FreeBusySlot } from '../domain/index.js';

const AUTH_AUDIENCE = 'urn:intexuraos:api';
const AUTH_DOMAIN = 'test-tenant.eu.auth0.com';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Calendar Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${AUTH_DOMAIN}/`;

  let fakeUserService: FakeUserServiceClient;
  let fakeCalendarClient: FakeGoogleCalendarClient;
  let fakeFailedEventRepository: FakeFailedEventRepository;
  let fakeCalendarActionExtractionService: FakeCalendarActionExtractionService;
  let fakeProcessedActionRepository: FakeProcessedActionRepository;

  async function createJwt(userId: string): Promise<string> {
    return await new jose.SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience(AUTH_AUDIENCE)
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;

    const publicKeyJwk = await jose.exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    jwksServer = Fastify({ logger: false });
    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({ keys: [publicKeyJwk] });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(async () => {
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = AUTH_AUDIENCE;
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    clearJwksCache();

    fakeUserService = new FakeUserServiceClient();
    fakeCalendarClient = new FakeGoogleCalendarClient();
    fakeFailedEventRepository = new FakeFailedEventRepository();
    fakeCalendarActionExtractionService = new FakeCalendarActionExtractionService();
    fakeProcessedActionRepository = new FakeProcessedActionRepository();

    setServices({
      userServiceClient: fakeUserService,
      googleCalendarClient: fakeCalendarClient,
      failedEventRepository: fakeFailedEventRepository,
      calendarActionExtractionService: fakeCalendarActionExtractionService,
      processedActionRepository: fakeProcessedActionRepository,
      calendarPreviewRepository: new FakeCalendarPreviewRepository(),
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /calendar/events', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/events',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns events on success', async () => {
      const jwt = await createJwt('user-123');
      const event: CalendarEvent = {
        id: 'event-1',
        summary: 'Test Meeting',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      };
      fakeCalendarClient.addEvent(event);

      const response = await app.inject({
        method: 'GET',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.events).toHaveLength(1);
      expect(body.data.events[0].summary).toBe('Test Meeting');
    });

    it('accepts query parameters', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'GET',
        url: '/events?calendarId=work&timeMin=2025-01-01T00:00:00Z&maxResults=10',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts timeMax and q query parameters', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'GET',
        url: '/events?timeMin=2025-01-01T00:00:00Z&timeMax=2025-01-31T23:59:59Z&q=meeting',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Google Calendar not connected');

      const response = await app.inject({
        method: 'GET',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    });

    it('returns 401 on token error', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('TOKEN_REFRESH_FAILED', 'Token expired');

      const response = await app.inject({
        method: 'GET',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 502 on internal calendar error', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setListResult(err({ code: 'INTERNAL_ERROR', message: 'API error' }));

      const response = await app.inject({
        method: 'GET',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe('GET /calendar/events/:eventId', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/events/event-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns event on success', async () => {
      const jwt = await createJwt('user-123');
      const event: CalendarEvent = {
        id: 'event-123',
        summary: 'Test Meeting',
        description: 'Test description',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      };
      fakeCalendarClient.addEvent(event);

      const response = await app.inject({
        method: 'GET',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.event.id).toBe('event-123');
      expect(body.data.event.summary).toBe('Test Meeting');
    });

    it('returns 404 when event not found', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setGetResult(err({ code: 'NOT_FOUND', message: 'Event not found' }));

      const response = await app.inject({
        method: 'GET',
        url: '/events/nonexistent',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('accepts calendarId query parameter', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Work Meeting',
        start: { date: '2025-01-01' },
        end: { date: '2025-01-02' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/events/event-123?calendarId=work',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Not connected');

      const response = await app.inject({
        method: 'GET',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /calendar/events', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/events',
        payload: {
          summary: 'New Event',
          start: { dateTime: '2025-01-01T10:00:00Z' },
          end: { dateTime: '2025-01-01T11:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates event on success', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          summary: 'New Meeting',
          description: 'Team sync',
          location: 'Conference Room A',
          start: { dateTime: '2025-01-01T10:00:00Z' },
          end: { dateTime: '2025-01-01T11:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.event.summary).toBe('New Meeting');
    });

    it('returns 400 when missing required fields', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          description: 'Missing summary',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates event with attendees', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          summary: 'Team Meeting',
          start: { dateTime: '2025-01-01T10:00:00Z' },
          end: { dateTime: '2025-01-01T11:00:00Z' },
          attendees: [{ email: 'colleague@example.com' }],
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('accepts calendarId in body', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          calendarId: 'work',
          summary: 'Work Event',
          start: { date: '2025-01-01' },
          end: { date: '2025-01-02' },
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('returns 400 on invalid request from calendar API', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setCreateResult(err({ code: 'INVALID_REQUEST', message: 'Invalid date' }));

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          summary: 'Bad Event',
          start: { dateTime: '2025-01-01T10:00:00Z' },
          end: { dateTime: '2025-01-01T11:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Not connected');

      const response = await app.inject({
        method: 'POST',
        url: '/events',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          summary: 'New Event',
          start: { dateTime: '2025-01-01T10:00:00Z' },
          end: { dateTime: '2025-01-01T11:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /calendar/events/:eventId', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        payload: { summary: 'Updated' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('updates event on success', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Original Title',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          summary: 'Updated Title',
          description: 'New description',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.event.summary).toBe('Updated Title');
    });

    it('updates event location', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Event',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          location: 'Conference Room B',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 404 when event not found', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setUpdateResult(err({ code: 'NOT_FOUND', message: 'Event not found' }));

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/nonexistent',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { summary: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('accepts calendarId in body', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Event',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          calendarId: 'work',
          summary: 'Updated',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('updates event times', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Event',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          start: { dateTime: '2025-01-01T14:00:00Z' },
          end: { dateTime: '2025-01-01T15:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('updates event with attendees', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Event',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          attendees: [
            { email: 'attendee1@example.com' },
            { email: 'attendee2@example.com', optional: true },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Not connected');

      const response = await app.inject({
        method: 'PATCH',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { summary: 'Updated' },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /calendar/events/:eventId', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/events/event-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('deletes event on success', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'To Delete',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it('returns 404 when event not found', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setDeleteResult(err({ code: 'NOT_FOUND', message: 'Event not found' }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/events/nonexistent',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('accepts calendarId query parameter', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.addEvent({
        id: 'event-123',
        summary: 'Event',
        start: { dateTime: '2025-01-01T10:00:00Z' },
        end: { dateTime: '2025-01-01T11:00:00Z' },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/events/event-123?calendarId=work',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Not connected');

      const response = await app.inject({
        method: 'DELETE',
        url: '/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /calendar/freebusy', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/freebusy',
        payload: {
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: '2025-01-02T00:00:00Z',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns free/busy info on success', async () => {
      const jwt = await createJwt('user-123');
      const slots: FreeBusySlot[] = [
        { start: '2025-01-01T10:00:00Z', end: '2025-01-01T11:00:00Z' },
      ];
      fakeCalendarClient.setFreeBusyResult(ok(new Map([['primary', slots]])));

      const response = await app.inject({
        method: 'POST',
        url: '/freebusy',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: '2025-01-02T00:00:00Z',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.calendars.primary.busy).toHaveLength(1);
    });

    it('returns 400 when missing required fields', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/freebusy',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts items array for multiple calendars', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setFreeBusyResult(
        ok(
          new Map([
            ['primary', [{ start: '2025-01-01T10:00:00Z', end: '2025-01-01T11:00:00Z' }]],
            ['work', []],
          ])
        )
      );

      const response = await app.inject({
        method: 'POST',
        url: '/freebusy',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: '2025-01-02T00:00:00Z',
          items: [{ id: 'primary' }, { id: 'work' }],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Object.keys(body.data.calendars)).toHaveLength(2);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('CONNECTION_NOT_FOUND', 'Not connected');

      const response = await app.inject({
        method: 'POST',
        url: '/freebusy',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          timeMin: '2025-01-01T00:00:00Z',
          timeMax: '2025-01-02T00:00:00Z',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Health endpoint', () => {
    it('returns health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.serviceName).toBe('calendar-agent');
    });
  });

  describe('POST /internal/calendar/process-action', () => {
    const validActionPayload = {
      action: {
        id: 'action-123',
        userId: 'user-456',
        title: 'Meeting at 2pm tomorrow',
      },
    };

    it('returns 401 without internal auth header', async () => {
      // Create a new app instance without the internal auth token
      await app.close();
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
      clearJwksCache();
      setServices({
        userServiceClient: fakeUserService,
        googleCalendarClient: fakeCalendarClient,
        failedEventRepository: fakeFailedEventRepository,
        calendarActionExtractionService: fakeCalendarActionExtractionService,
        processedActionRepository: fakeProcessedActionRepository,
        calendarPreviewRepository: new FakeCalendarPreviewRepository(),
      });
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(401);

      // Restore for other tests
      await app.close();
      process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
      clearJwksCache();
      setServices({
        userServiceClient: fakeUserService,
        googleCalendarClient: fakeCalendarClient,
        failedEventRepository: fakeFailedEventRepository,
        calendarActionExtractionService: fakeCalendarActionExtractionService,
        processedActionRepository: fakeProcessedActionRepository,
        calendarPreviewRepository: new FakeCalendarPreviewRepository(),
      });
      app = await buildServer();
    });

    it('returns 401 with wrong internal auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(401);
    });

    it('processes valid action and omits resourceUrl without Google htmlLink', async () => {
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

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('completed');
      expect(body.data.resourceUrl).toBeUndefined();
      expect(response.body).not.toContain('/#/calendar');
    });

    it('returns failed status when event extraction is invalid', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Unclear Request',
          start: null,
          end: null,
          location: null,
          description: null,
          valid: false,
          error: 'Could not determine event time',
          reasoning: 'No specific time mentioned',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
      expect(body.data.message).toBe('Could not determine event time');
    });

    it('returns 403 when extraction returns NOT_CONNECTED error', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: false,
        error: { code: 'NO_API_KEY', message: 'No API key configured' },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 401 when Google Calendar returns TOKEN_ERROR', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };
      fakeCalendarClient.setCreateResult(
        err({ code: 'TOKEN_ERROR', message: 'Invalid access token' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Invalid access token');
    });

    it('returns failed status when Google Calendar returns INTERNAL_ERROR', async () => {
      fakeCalendarActionExtractionService.extractEventResult = {
        ok: true,
        value: {
          summary: 'Test Event',
          start: '2025-01-15T10:00:00',
          end: '2025-01-15T11:00:00',
          location: null,
          description: null,
          valid: true,
          error: null,
          reasoning: 'test',
        },
      };
      fakeCalendarClient.setCreateResult(
        err({ code: 'INTERNAL_ERROR', message: 'Calendar API error' })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/process-action',
        headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
        payload: validActionPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
      expect(body.data.message).toBe('Calendar API error');
    });
  });

  describe('GET /calendar/failed-events', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/failed-events',
      });

      expect(response.statusCode).toBe(401);
    });

    it('lists failed events for authenticated user', async () => {
      const token = await createJwt('user-123');
      fakeFailedEventRepository.clear();

      const response = await app.inject({
        method: 'GET',
        url: '/failed-events',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { success: boolean; data: { failedEvents: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.failedEvents).toEqual([]);
    });

    it('lists failed events with limit parameter', async () => {
      const token = await createJwt('user-123');
      fakeFailedEventRepository.clear();

      const response = await app.inject({
        method: 'GET',
        url: '/failed-events?limit=5',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { success: boolean; data: { failedEvents: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.failedEvents).toEqual([]);
    });

    it('returns 502 when repository fails', async () => {
      const token = await createJwt('user-123');
      fakeFailedEventRepository.setListResult(err({ code: 'INTERNAL_ERROR', message: 'DB error' }));

      const response = await app.inject({
        method: 'GET',
        url: '/failed-events',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = response.json() as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('DELETE /calendar/failed-events/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/failed-events/event-123',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when event not found', async () => {
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'DELETE',
        url: '/failed-events/nonexistent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when event belongs to different user', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'other-user',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Test error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('other-user');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      const response = await app.inject({
        method: 'DELETE',
        url: `/failed-events/${String(eventId)}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('deletes failed event and returns 204', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Test error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      const response = await app.inject({
        method: 'DELETE',
        url: `/failed-events/${String(eventId)}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(204);

      const afterDelete = await fakeFailedEventRepository.list('user-123');
      expect(afterDelete.ok && afterDelete.value).toHaveLength(0);
    });

    it('returns 502 when get fails', async () => {
      const token = await createJwt('user-123');
      fakeFailedEventRepository.setGetResult(err({ code: 'INTERNAL_ERROR', message: 'DB error' }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/failed-events/event-123',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
    });

    it('returns 502 when delete fails', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Test error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      fakeFailedEventRepository.setDeleteResult(
        err({ code: 'INTERNAL_ERROR', message: 'Delete failed' })
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/failed-events/${String(eventId)}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
      const body = response.json() as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });
  });

  describe('POST /calendar/failed-events/:id/retry', () => {
    it('returns 401 when not authenticated', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/failed-events/event-123/retry',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when event not found', async () => {
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/failed-events/nonexistent/retry',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json() as { success: boolean; error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when event belongs to different user', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'other-user',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: null,
        description: null,
        error: 'Test error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('other-user');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      const response = await app.inject({
        method: 'POST',
        url: `/failed-events/${String(eventId)}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 422 when start or end is missing', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: null,
        end: null,
        location: null,
        description: null,
        error: 'Missing time',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      const response = await app.inject({
        method: 'POST',
        url: `/failed-events/${String(eventId)}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json() as { success: boolean; error: { message: string } };
      expect(body.error.message).toContain('missing start or end');
    });

    it('creates event and deletes failed event on success', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Retry Event',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: 'Room A',
        description: 'Test description',
        error: 'Previous error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      const response = await app.inject({
        method: 'POST',
        url: `/failed-events/${String(eventId)}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { success: boolean; data: { event: { summary: string } } };
      expect(body.success).toBe(true);
      expect(body.data.event.summary).toBe('Retry Event');

      const afterRetry = await fakeFailedEventRepository.list('user-123');
      expect(afterRetry.ok && afterRetry.value).toHaveLength(0);
    });

    it('returns 422 when calendar API fails', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Test Event',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: null,
        description: null,
        error: 'Previous error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      fakeCalendarClient.setCreateResult(err({ code: 'INVALID_REQUEST', message: 'Invalid time' }));

      const response = await app.inject({
        method: 'POST',
        url: `/failed-events/${String(eventId)}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
      const body = response.json() as { success: boolean; error: { message: string } };
      expect(body.error.message).toBe('Invalid time');
    });

    it('returns 502 when get fails', async () => {
      const token = await createJwt('user-123');
      fakeFailedEventRepository.setGetResult(err({ code: 'INTERNAL_ERROR', message: 'DB error' }));

      const response = await app.inject({
        method: 'POST',
        url: '/failed-events/event-123/retry',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(502);
    });

    it('succeeds but logs error when delete of failed event fails after retry', async () => {
      const token = await createJwt('user-123');
      await fakeFailedEventRepository.create({
        userId: 'user-123',
        actionId: 'action-1',
        originalText: 'test',
        summary: 'Retry Event',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
        location: null,
        description: null,
        error: 'Previous error',
        reasoning: 'test',
      });
      const events = await fakeFailedEventRepository.list('user-123');
      const eventId = events.ok ? events.value[0]?.id : 'unknown';

      fakeFailedEventRepository.setDeleteResult(
        err({ code: 'INTERNAL_ERROR', message: 'Delete failed' })
      );

      const response = await app.inject({
        method: 'POST',
        url: `/failed-events/${String(eventId)}/retry`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        success: boolean;
        data: { event: { summary: string } };
      };
      expect(body.success).toBe(true);
      expect(body.data.event.summary).toBe('Retry Event');

      const afterRetry = await fakeFailedEventRepository.list('user-123');
      expect(afterRetry.ok && afterRetry.value).toHaveLength(1);
    });
  });
});
