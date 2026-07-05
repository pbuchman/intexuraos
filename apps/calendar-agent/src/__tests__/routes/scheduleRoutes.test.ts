import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { ok } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import {
  FakeCalendarActionExtractionService,
  FakeCalendarPreviewRepository,
  FakeCalendarScheduleRepository,
  FakeFailedEventRepository,
  FakeGoogleCalendarClient,
  FakeProcessedActionRepository,
  FakeUserServiceClient,
  FakeWhatsAppScheduleClient,
} from '../fakes.js';

const AUTH_AUDIENCE = 'urn:intexuraos:api';
const AUTH_DOMAIN = 'test-tenant.eu.auth0.com';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('scheduleRoutes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${AUTH_DOMAIN}/`;
  let scheduleRepository: FakeCalendarScheduleRepository;
  let whatsAppScheduleClient: FakeWhatsAppScheduleClient;

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

    scheduleRepository = new FakeCalendarScheduleRepository();
    whatsAppScheduleClient = new FakeWhatsAppScheduleClient();
    whatsAppScheduleClient.setMatrixDeliveryStatusResult(ok({ status: 'ready' }));

    setServices({
      userServiceClient: new FakeUserServiceClient(),
      googleCalendarClient: new FakeGoogleCalendarClient(),
      failedEventRepository: new FakeFailedEventRepository(),
      calendarActionExtractionService: new FakeCalendarActionExtractionService(),
      processedActionRepository: new FakeProcessedActionRepository(),
      calendarPreviewRepository: new FakeCalendarPreviewRepository(),
      calendarScheduleRepository: scheduleRepository as never,
      whatsAppScheduleClient: whatsAppScheduleClient as never,
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  it('requires auth for GET /schedules/calendar-daily-lookahead', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
    });

    expect(response.statusCode).toBe(401);
  });

  it('requires auth for PUT /schedules/calendar-daily-lookahead', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/schedules/calendar-daily-lookahead',
      payload: {
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns disabled default settings when the user has no schedule', async () => {
    const jwt = await createJwt('user-123');

    const response = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      schedule: {
        enabled: false,
        localTime: '08:00',
      },
      delivery: { status: 'ready' },
    });
  });

  it('returns the current user schedule and delivery readiness', async () => {
    const jwt = await createJwt('user-123');
    scheduleRepository.seedSchedule({
      id: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      status: 'active',
      cadence: { type: 'daily', localTime: '09:15', timeZone: 'America/New_York' },
      payload: {
        prompt: 'Send me events that they have in the calendar in the next 24 hours.',
        target: 'intex_agent',
      },
      nextRunAt: '2026-07-04T13:15:00.000Z',
      lastRunAt: '2026-07-03T13:15:05.000Z',
      schemaVersion: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.schedule).toEqual({
      enabled: true,
      localTime: '09:15',
      timeZone: 'America/New_York',
      nextRunAt: '2026-07-04T13:15:00.000Z',
      lastRunAt: '2026-07-03T13:15:05.000Z',
    });
    expect(body.data.delivery).toEqual({ status: 'ready' });
  });

  it('validates local time and timezone on PUT', async () => {
    const jwt = await createJwt('user-123');

    const response = await app.inject({
      method: 'PUT',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enabled: true,
        localTime: '09:10',
        timeZone: 'Mars/Olympus',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('upserts the authenticated user schedule and includes readiness', async () => {
    const jwt = await createJwt('user-123');

    const response = await app.inject({
      method: 'PUT',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.schedule.enabled).toBe(true);
    expect(body.data.schedule.localTime).toBe('09:15');
    expect(body.data.schedule.timeZone).toBe('America/New_York');
    expect(body.data.delivery).toEqual({ status: 'ready' });
  });

  it('returns delivery readiness errors distinctly from setup-required', async () => {
    const jwt = await createJwt('user-123');
    whatsAppScheduleClient.setMatrixDeliveryStatusResult(
      ok({ status: 'error', message: 'Matrix adapter readiness request failed' })
    );

    const response = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.delivery).toEqual({
      status: 'error',
      message: 'Matrix adapter readiness request failed',
    });
  });

  it('returns misconfigured when schedule dependencies are missing', async () => {
    await app.close();
    setServices({
      userServiceClient: new FakeUserServiceClient(),
      googleCalendarClient: new FakeGoogleCalendarClient(),
      failedEventRepository: new FakeFailedEventRepository(),
      calendarActionExtractionService: new FakeCalendarActionExtractionService(),
      processedActionRepository: new FakeProcessedActionRepository(),
      calendarPreviewRepository: new FakeCalendarPreviewRepository(),
    });
    app = await buildServer();
    const jwt = await createJwt('user-123');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
    });
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
      },
    });

    expect(getResponse.statusCode).toBe(503);
    expect(putResponse.statusCode).toBe(503);
  });

  it('returns downstream errors from schedule and delivery dependencies', async () => {
    const jwt = await createJwt('user-123');
    scheduleRepository.setGetByUserAndTaskTypeResult(
      {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'schedule read failed' },
      }
    );

    const getResponse = await app.inject({
      method: 'GET',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(getResponse.statusCode).toBe(502);

    scheduleRepository.setGetByUserAndTaskTypeResult(ok(null));
    whatsAppScheduleClient.setMatrixDeliveryStatusResult(
      { ok: false, error: new Error('delivery read failed') }
    );
    const putResponse = await app.inject({
      method: 'PUT',
      url: '/schedules/calendar-daily-lookahead',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
      },
    });

    expect(putResponse.statusCode).toBe(502);
  });
});
