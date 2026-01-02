import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeActionServiceClient,
  FakeResearchServiceClient,
  FakeNotificationSender,
  FakeActionRepository,
  FakeActionEventPublisher,
  createFakeServices,
} from './fakes.js';

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Research Agent Routes', () => {
  let app: FastifyInstance;

  let fakeActionClient: FakeActionServiceClient;
  let fakeResearchClient: FakeResearchServiceClient;
  let fakeNotificationSender: FakeNotificationSender;
  let fakeActionRepository: FakeActionRepository;
  let fakeActionEventPublisher: FakeActionEventPublisher;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    fakeActionClient = new FakeActionServiceClient();
    fakeResearchClient = new FakeResearchServiceClient();
    fakeNotificationSender = new FakeNotificationSender();
    fakeActionRepository = new FakeActionRepository();
    fakeActionEventPublisher = new FakeActionEventPublisher();

    setServices(
      createFakeServices({
        actionServiceClient: fakeActionClient,
        researchServiceClient: fakeResearchClient,
        notificationSender: fakeNotificationSender,
        actionRepository: fakeActionRepository,
        actionEventPublisher: fakeActionEventPublisher,
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
      expect(body.error).toBe('Action type mismatch');
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

  describe('POST /internal/actions (action creation endpoint)', () => {
    it('returns 401 when no internal auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 401 when internal auth token is wrong', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when request body is missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('creates action with status pending and publishes event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          id: string;
          userId: string;
          commandId: string;
          type: string;
          title: string;
          status: string;
          confidence: number;
        };
      };

      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('user-123');
      expect(body.data.commandId).toBe('cmd-456');
      expect(body.data.type).toBe('research');
      expect(body.data.title).toBe('Test Research');
      expect(body.data.status).toBe('pending');
      expect(body.data.confidence).toBe(0.95);

      const savedActions = fakeActionRepository.getActions();
      expect(savedActions.size).toBe(1);
      const savedAction = savedActions.get(body.data.id);
      expect(savedAction).toBeDefined();
      expect(savedAction?.status).toBe('pending');

      const publishedEvents = fakeActionEventPublisher.getPublishedEvents();
      expect(publishedEvents).toHaveLength(1);
      expect(publishedEvents[0]?.type).toBe('action.created');
      expect(publishedEvents[0]?.actionId).toBe(body.data.id);
      expect(publishedEvents[0]?.userId).toBe('user-123');
      expect(publishedEvents[0]?.actionType).toBe('research');
    });

    it('creates action with optional payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
          payload: { customField: 'customValue' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { id: string; payload: Record<string, unknown> };
      };

      expect(body.data.payload).toEqual({ customField: 'customValue' });
    });

    it('returns 500 when action repository fails', async () => {
      fakeActionRepository.setFailNext(true, new Error('Database unavailable'));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Failed to create action');
    });

    it('continues successfully even when event publishing fails', async () => {
      fakeActionEventPublisher.setFailNext(true, {
        code: 'PUBLISH_FAILED',
        message: 'Pub/Sub unavailable',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          userId: 'user-123',
          commandId: 'cmd-456',
          type: 'research',
          title: 'Test Research',
          confidence: 0.95,
        },
      });

      expect(response.statusCode).toBe(201);

      const savedActions = fakeActionRepository.getActions();
      expect(savedActions.size).toBe(1);
    });
  });

  describe('GET /router/actions (list user actions)', () => {
    beforeEach(() => {
      process.env['AUTH_JWKS_URL'] = 'https://example.auth.com/.well-known/jwks.json';
      process.env['AUTH_ISSUER'] = 'https://example.auth.com/';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
    });

    it('returns 401 when no auth token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/router/actions',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns list of actions for authenticated user', async () => {
      fakeActionRepository.save({
        id: 'action-1',
        userId: 'user-123',
        commandId: 'cmd-1',
        type: 'research',
        confidence: 0.95,
        title: 'Test Action',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'GET',
        url: '/router/actions',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { actions: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.actions).toHaveLength(1);
    });
  });

  describe('PATCH /router/actions/:actionId (update action status)', () => {
    beforeEach(() => {
      process.env['AUTH_JWKS_URL'] = 'https://example.auth.com/.well-known/jwks.json';
      process.env['AUTH_ISSUER'] = 'https://example.auth.com/';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
    });

    it('returns 401 when no auth token', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/router/actions/action-1',
        payload: { status: 'rejected' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when action not found', async () => {
      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/actions/nonexistent',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
        payload: { status: 'rejected' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when user does not own action', async () => {
      await fakeActionRepository.save({
        id: 'action-1',
        userId: 'other-user',
        commandId: 'cmd-1',
        type: 'research',
        confidence: 0.95,
        title: 'Test Action',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/actions/action-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
        payload: { status: 'rejected' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('updates action status successfully', async () => {
      await fakeActionRepository.save({
        id: 'action-1',
        userId: 'user-123',
        commandId: 'cmd-1',
        type: 'research',
        confidence: 0.95,
        title: 'Test Action',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'PATCH',
        url: '/router/actions/action-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
        payload: { status: 'rejected' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { action: { id: string; status: string } };
      };
      expect(body.success).toBe(true);
      expect(body.data.action.status).toBe('rejected');
    });
  });

  describe('DELETE /router/actions/:actionId (delete action)', () => {
    beforeEach(() => {
      process.env['AUTH_JWKS_URL'] = 'https://example.auth.com/.well-known/jwks.json';
      process.env['AUTH_ISSUER'] = 'https://example.auth.com/';
      process.env['AUTH_AUDIENCE'] = 'test-audience';
    });

    it('returns 401 when no auth token', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/router/actions/action-1',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when action not found', async () => {
      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/actions/nonexistent',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 404 when user does not own action', async () => {
      await fakeActionRepository.save({
        id: 'action-1',
        userId: 'other-user',
        commandId: 'cmd-1',
        type: 'research',
        confidence: 0.95,
        title: 'Test Action',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/actions/action-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('deletes action successfully', async () => {
      await fakeActionRepository.save({
        id: 'action-1',
        userId: 'user-123',
        commandId: 'cmd-1',
        type: 'research',
        confidence: 0.95,
        title: 'Test Action',
        status: 'pending',
        payload: {},
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      const mockToken =
        'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImF1ZCI6InRlc3QtYXVkaWVuY2UiLCJpc3MiOiJodHRwczovL2V4YW1wbGUuYXV0aC5jb20vIiwiaWF0IjoxNzA5MjE3NjAwfQ.mock';

      const response = await app.inject({
        method: 'DELETE',
        url: '/router/actions/action-1',
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const action = await fakeActionRepository.getById('action-1');
      expect(action).toBeNull();
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
