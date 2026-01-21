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
      subscription: 'projects/test/subscriptions/calendar-preview-generate',
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
        subscription: 'projects/test/subscriptions/calendar-preview-generate',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
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
        subscription: 'projects/test/subscriptions/calendar-preview-generate',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/calendar/generate-preview',
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
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { previewId: string; status: string } };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failed');
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
});
