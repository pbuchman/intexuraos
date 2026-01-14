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
} from './fakes.js';
import type { CalendarEvent, FreeBusySlot } from '../domain/index.js';

const AUTH_AUDIENCE = 'urn:intexuraos:api';
const AUTH_DOMAIN = 'test-tenant.eu.auth0.com';

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

    clearJwksCache();

    fakeUserService = new FakeUserServiceClient();
    fakeCalendarClient = new FakeGoogleCalendarClient();
    fakeFailedEventRepository = new FakeFailedEventRepository();
    fakeCalendarActionExtractionService = new FakeCalendarActionExtractionService();

    setServices({
      userServiceClient: fakeUserService,
      googleCalendarClient: fakeCalendarClient,
      failedEventRepository: fakeFailedEventRepository,
      calendarActionExtractionService: fakeCalendarActionExtractionService,
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
        url: '/calendar/events',
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
        url: '/calendar/events',
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
        url: '/calendar/events?calendarId=work&timeMin=2025-01-01T00:00:00Z&maxResults=10',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts timeMax and q query parameters', async () => {
      const jwt = await createJwt('user-123');

      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events?timeMin=2025-01-01T00:00:00Z&timeMax=2025-01-31T23:59:59Z&q=meeting',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('NOT_CONNECTED', 'Google Calendar not connected');

      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    });

    it('returns 401 on token error', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('TOKEN_ERROR', 'Token expired');

      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 502 on internal calendar error', async () => {
      const jwt = await createJwt('user-123');
      fakeCalendarClient.setListResult(err({ code: 'INTERNAL_ERROR', message: 'API error' }));

      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(502);
    });
  });

  describe('GET /calendar/events/:eventId', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/nonexistent',
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
        url: '/calendar/events/event-123?calendarId=work',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('NOT_CONNECTED', 'Not connected');

      const response = await app.inject({
        method: 'GET',
        url: '/calendar/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /calendar/events', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calendar/events',
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
        url: '/calendar/events',
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
        url: '/calendar/events',
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
        url: '/calendar/events',
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
        url: '/calendar/events',
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
        url: '/calendar/events',
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
      fakeUserService.setTokenError('NOT_CONNECTED', 'Not connected');

      const response = await app.inject({
        method: 'POST',
        url: '/calendar/events',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/nonexistent',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: {
          start: { dateTime: '2025-01-01T14:00:00Z' },
          end: { dateTime: '2025-01-01T15:00:00Z' },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('NOT_CONNECTED', 'Not connected');

      const response = await app.inject({
        method: 'PATCH',
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/event-123',
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
        url: '/calendar/events/nonexistent',
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
        url: '/calendar/events/event-123?calendarId=work',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 403 when not connected', async () => {
      const jwt = await createJwt('user-123');
      fakeUserService.setTokenError('NOT_CONNECTED', 'Not connected');

      const response = await app.inject({
        method: 'DELETE',
        url: '/calendar/events/event-123',
        headers: { authorization: `Bearer ${jwt}` },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /calendar/freebusy', () => {
    it('returns 401 without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calendar/freebusy',
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
        url: '/calendar/freebusy',
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
        url: '/calendar/freebusy',
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
        url: '/calendar/freebusy',
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
      fakeUserService.setTokenError('NOT_CONNECTED', 'Not connected');

      const response = await app.inject({
        method: 'POST',
        url: '/calendar/freebusy',
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
});
