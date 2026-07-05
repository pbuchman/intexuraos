import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ok } from '@intexuraos/common-core';
import type { ClaimedCalendarSchedule } from '../../domain/index.js';
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

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

function claimedSchedule(): ClaimedCalendarSchedule {
  return {
    schedule: {
      id: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      status: 'active',
      cadence: { type: 'daily', localTime: '09:00', timeZone: 'America/New_York' },
      payload: {
        prompt: 'Send me events that they have in the calendar in the next 24 hours.',
        target: 'intex_agent',
      },
      nextRunAt: '2026-07-04T13:00:00.000Z',
      schemaVersion: 1,
    },
    localDate: '2026-07-04',
    scheduledFor: '2026-07-04T13:00:00.000Z',
    startedAt: '2026-07-04T13:00:10.000Z',
  };
}

describe('internalScheduleRoutes', () => {
  let app: FastifyInstance;
  let scheduleRepository: FakeCalendarScheduleRepository;
  let whatsAppScheduleClient: FakeWhatsAppScheduleClient;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'http://localhost:9999/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';

    scheduleRepository = new FakeCalendarScheduleRepository();
    whatsAppScheduleClient = new FakeWhatsAppScheduleClient();
    scheduleRepository.setClaimDueSchedulesResult(
      ok([claimedSchedule()])
    );

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

  it('rejects unauthenticated tick requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/calendar/schedules/tick',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('accepts internal auth with an empty body and processes due schedules', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/calendar/schedules/tick',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(whatsAppScheduleClient.sendOutboundMatrixMessageCalls).toEqual([
      {
        userId: 'user-123',
        target: 'intex_agent',
        text: 'Send me events that they have in the calendar in the next 24 hours.',
        startNewSession: true,
        idempotencyKey: 'calendar:user-123_calendar_daily_lookahead:2026-07-04',
      },
    ]);
  });

  it('accepts scheduler OIDC bearer auth', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/calendar/schedules/tick',
      headers: { authorization: 'Bearer fake-oidc-token' },
    });

    expect(response.statusCode).toBe(200);
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

    const response = await app.inject({
      method: 'POST',
      url: '/internal/calendar/schedules/tick',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    });

    expect(response.statusCode).toBe(503);
  });

  it('returns internal errors when schedule processing fails', async () => {
    scheduleRepository.setClaimDueSchedulesResult({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'claim failed' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/calendar/schedules/tick',
      headers: { 'x-internal-auth': INTERNAL_AUTH_TOKEN },
    });

    expect(response.statusCode).toBe(500);
  });
});
