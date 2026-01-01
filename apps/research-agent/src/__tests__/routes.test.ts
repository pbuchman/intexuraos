import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeActionServiceClient,
  FakeResearchServiceClient,
  FakeNotificationSender,
  createFakeServices,
} from './fakes.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Research Agent Routes', () => {
  let app: FastifyInstance;

  let fakeActionClient: FakeActionServiceClient;
  let fakeResearchClient: FakeResearchServiceClient;
  let fakeNotificationSender: FakeNotificationSender;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    fakeActionClient = new FakeActionServiceClient();
    fakeResearchClient = new FakeResearchServiceClient();
    fakeNotificationSender = new FakeNotificationSender();

    setServices(
      createFakeServices({
        actionServiceClient: fakeActionClient,
        researchServiceClient: fakeResearchClient,
        notificationSender: fakeNotificationSender,
      })
    );

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /internal/actions/research (PubSub push endpoint)', () => {
    const createValidPayload = (overrides: Record<string, unknown> = {}): object => {
      const event = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'research',
        title: 'Test Research',
        payload: {
          prompt: 'What is AI?',
          confidence: 0.95,
        },
        timestamp: '2025-01-01T12:00:00.000Z',
        ...overrides,
      };

      return {
        message: {
          data: Buffer.from(JSON.stringify(event)).toString('base64'),
          messageId: 'pubsub-msg-1',
          publishTime: '2025-01-01T12:00:00.000Z',
        },
        subscription: 'projects/test/subscriptions/actions-research',
      };
    };

    it('returns 401 when no internal auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        payload: createValidPayload(),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth token is wrong', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
        payload: createValidPayload(),
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
      await app.close();
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': 'any-token',
        },
        payload: createValidPayload(),
      });

      expect(response.statusCode).toBe(401);
    });

    describe('Pub/Sub OIDC authentication', () => {
      it('accepts Pub/Sub push with from: noreply@google.com header (no x-internal-auth)', async () => {
        fakeResearchClient.setNextResearchId('research-123');

        const response = await app.inject({
          method: 'POST',
          url: '/internal/actions/research',
          headers: {
            'content-type': 'application/json',
            from: 'noreply@google.com',
            // NOTE: NO x-internal-auth header - should still work via OIDC
          },
          payload: createValidPayload(),
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { success: boolean; researchId: string };
        expect(body.success).toBe(true);
        expect(body.researchId).toBe('research-123');
      });

      it('rejects direct calls without x-internal-auth or Pub/Sub from header', async () => {
        const response = await app.inject({
          method: 'POST',
          url: '/internal/actions/research',
          headers: {
            'content-type': 'application/json',
            // NO from: noreply@google.com
            // NO x-internal-auth
          },
          payload: createValidPayload(),
        });

        expect(response.statusCode).toBe(401);
      });
    });

    it('returns 400 when message data is invalid base64', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: 'not-valid-json-after-decode!!',
            messageId: 'pubsub-invalid',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Invalid message format');
    });

    it('returns 400 when message is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when event type is not action.created', async () => {
      const event = {
        type: 'action.updated',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'research',
        title: 'Test Research',
        payload: { prompt: 'test', confidence: 0.9 },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'pubsub-msg-1',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Invalid event type');
    });

    it('returns 400 when action type is not research', async () => {
      const event = {
        type: 'action.created',
        actionId: 'action-123',
        userId: 'user-456',
        commandId: 'cmd-789',
        actionType: 'todo',
        title: 'Test Todo',
        payload: { prompt: 'test', confidence: 0.9 },
        timestamp: '2025-01-01T12:00:00.000Z',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: {
            data: Buffer.from(JSON.stringify(event)).toString('base64'),
            messageId: 'pubsub-msg-1',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Invalid action type');
    });

    it('processes valid research action and returns 200', async () => {
      fakeResearchClient.setNextResearchId('research-999');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createValidPayload(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; researchId: string };
      expect(body.success).toBe(true);
      expect(body.researchId).toBe('research-999');

      expect(fakeActionClient.getStatusUpdates().get('action-123')).toBe('processing');

      const actionUpdate = fakeActionClient.getActionUpdates().get('action-123');
      expect(actionUpdate?.status).toBe('completed');

      expect(fakeNotificationSender.getNotifications()).toHaveLength(1);
    });

    it('returns 500 when processing fails', async () => {
      fakeActionClient.setFailNext(true, new Error('Database unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createValidPayload(),
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('Failed to mark action as processing');
    });
  });

  describe('System endpoints', () => {
    it('GET /health returns 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
    });

    it('GET /openapi.json returns 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { openapi: string };
      expect(body.openapi).toBe('3.1.1');
    });
  });
});
