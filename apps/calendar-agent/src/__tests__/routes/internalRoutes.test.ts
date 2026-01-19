/**
 * Tests for internal API routes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { err } from '@intexuraos/common-core';
import { buildServer } from '../../server.js';
import { resetServices, setServices } from '../../services.js';
import {
  FakeGoogleCalendarClient,
  FakeUserServiceClient,
  FakeFailedEventRepository,
  FakeCalendarActionExtractionService,
  FakeProcessedActionRepository,
} from '../fakes.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeUserService: FakeUserServiceClient;
  let fakeCalendarClient: FakeGoogleCalendarClient;
  let fakeFailedEventRepository: FakeFailedEventRepository;
  let fakeCalendarActionExtractionService: FakeCalendarActionExtractionService;
  let fakeProcessedActionRepository: FakeProcessedActionRepository;

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

    setServices({
      userServiceClient: fakeUserService,
      googleCalendarClient: fakeCalendarClient,
      failedEventRepository: fakeFailedEventRepository,
      calendarActionExtractionService: fakeCalendarActionExtractionService,
      processedActionRepository: fakeProcessedActionRepository,
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
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
  });
});
