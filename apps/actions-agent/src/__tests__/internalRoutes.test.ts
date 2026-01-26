/**
 * Tests for internal routes.
 * Tests internal endpoints for action creation and processing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { err } from '@intexuraos/common-core';
import { buildServer } from '../server.js';
import { getServices, resetServices, setServices } from '../services.js';
import {
  FakeActionRepository,
  FakeActionEventPublisher,
  FakeActionServiceClient,
  FakeResearchServiceClient,
  FakeNotificationSender,
  createFakeServices,
  createFakeHandleApprovalReplyUseCase,
  createFakeRetryPendingActionsUseCase,
} from './fakes.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import type { ApprovalReplyEvent } from '../domain/models/approvalReplyEvent.js';
import type { Action } from '../domain/models/action.js';

vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization as string | undefined;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const payloadBase64 = token.split('.')[1];
          if (payloadBase64 !== undefined) {
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString()) as {
              sub?: string;
            };
            if (payload.sub !== undefined) {
              return { userId: payload.sub };
            }
          }
        } catch {
          /* Invalid token format */
        }
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let fakeActionRepository: FakeActionRepository;
  let fakeActionEventPublisher: FakeActionEventPublisher;

  beforeEach(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    fakeActionRepository = new FakeActionRepository();
    fakeActionEventPublisher = new FakeActionEventPublisher();

    setServices(
      createFakeServices({
        actionServiceClient: new FakeActionServiceClient(),
        researchServiceClient: new FakeResearchServiceClient(),
        notificationSender: new FakeNotificationSender(),
        actionRepository: fakeActionRepository,
        actionEventPublisher: fakeActionEventPublisher,
        retryPendingActionsUseCase: createFakeRetryPendingActionsUseCase({
          returnResult: {
            processed: 5,
            skipped: 2,
            failed: 1,
            total: 8,
            skipReasons: {},
          },
        }),
        handleApprovalReplyUseCase: createFakeHandleApprovalReplyUseCase({
          returnResult: {
            matched: true,
            actionId: 'action-1',
            intent: 'approve',
            outcome: 'approved',
          },
        }),
      })
    );

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /internal/actions', () => {
    const validBody = {
      userId: 'user-1',
      commandId: 'cmd-1',
      type: 'todo' as const,
      title: 'Test Action',
      confidence: 0.95,
    };

    it('returns 401 without internal auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('creates action with valid auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Test Action');
      expect(fakeActionRepository.getActions().size).toBe(1);
    });

    it('creates action with payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          ...validBody,
          payload: { prompt: 'Custom prompt' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.data.payload).toEqual({ prompt: 'Custom prompt' });
    });

    it('returns 500 when action repository fails', async () => {
      fakeActionRepository.setFailNext(true, new Error('Firestore error'));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(500);
    });

    it('publishes action.created event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      expect(fakeActionEventPublisher.getPublishedEvents().length).toBe(1);
      expect(fakeActionEventPublisher.getPublishedEvents()[0]).toEqual(
        expect.objectContaining({
          type: 'action.created',
          actionType: 'todo',
          userId: 'user-1',
        })
      );
    });

    it('returns 201 even when event publishing fails', async () => {
      fakeActionEventPublisher.setFailNext(true, {
        code: 'PUBLISH_FAILED',
        message: 'Failed to publish',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      expect(fakeActionRepository.getActions().size).toBe(1);
    });
  });

  describe('POST /internal/actions/:actionType', () => {
    const createActionEvent = (
      overrides: Partial<ActionCreatedEvent> = {}
    ): ActionCreatedEvent => ({
      type: 'action.created',
      actionId: 'action-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      actionType: 'todo',
      title: 'Test Todo',
      payload: { prompt: 'Test', confidence: 0.95 },
      timestamp: new Date().toISOString(),
      ...overrides,
    });

    const createPubSubPayload = (event: ActionCreatedEvent): {
      message: { data: string; messageId: string; publishTime: string };
      subscription: string;
    } => ({
      message: {
        data: Buffer.from(JSON.stringify(event)).toString('base64'),
        messageId: 'msg-1',
        publishTime: '2025-01-01T12:00:00.000Z',
      },
      subscription: 'projects/test/subscriptions/actions-todo',
    });

    it('returns 401 without auth (non-PubSub request)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts PubSub push requests with from header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        headers: {
          from: 'noreply@google.com',
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 for invalid base64 data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: 'not-valid-base64!!!', messageId: 'msg-1' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid event type', async () => {
      const event = createActionEvent({ type: 'invalid.type' as ActionCreatedEvent['type'] });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for action type mismatch', async () => {
      const event = createActionEvent({ actionType: 'todo' });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/research', // URL says research, event says todo
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for unsupported action type', async () => {
      const event = createActionEvent({ actionType: 'unsupported' as Action['type'] });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/unsupported',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when handler fails', async () => {
      // Get the services and mock the handler's execute method
      const services = getServices();

      // Mock the handler's execute method to return an error
      vi.spyOn(services.todo, 'execute').mockResolvedValue(
        err(new Error('Handler failed'))
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(500);

      // Restore the mock
      vi.spyOn(services.todo, 'execute').mockRestore();
    });

    it('processes action successfully with valid handler', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/todo',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.actionId).toBe('action-1');
    });
  });

  describe('POST /internal/actions/process', () => {
    const createActionEvent = (
      overrides: Partial<ActionCreatedEvent> = {}
    ): ActionCreatedEvent => ({
      type: 'action.created',
      actionId: 'action-1',
      userId: 'user-1',
      commandId: 'cmd-1',
      actionType: 'todo',
      title: 'Test Todo',
      payload: { prompt: 'Test', confidence: 0.95 },
      timestamp: new Date().toISOString(),
      ...overrides,
    });

    const createPubSubPayload = (event: ActionCreatedEvent): {
      message: { data: string; messageId: string; publishTime: string };
    } => ({
      message: {
        data: Buffer.from(JSON.stringify(event)).toString('base64'),
        messageId: 'msg-1',
        publishTime: '2025-01-01T12:00:00.000Z',
      },
    });

    it('returns 401 without auth (non-PubSub request)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts PubSub push requests with from header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          from: 'noreply@google.com',
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 for invalid base64 data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: 'not-valid-base64!!!', messageId: 'msg-1' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid event type', async () => {
      const event = createActionEvent({ type: 'invalid.type' as ActionCreatedEvent['type'] });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns success with skipped=true when no handler exists', async () => {
      const event = createActionEvent({ actionType: 'unsupported' as Action['type'] });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('no_handler');
    });

    it('returns 500 when handler fails', async () => {
      // Get the current services and mock the handler
      const services = getServices();
      vi.spyOn(services.todo, 'execute').mockResolvedValue(
        err(new Error('Handler failed'))
      );

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(500);

      // Restore the mock
      vi.spyOn(services.todo, 'execute').mockRestore();
    });

    it('processes action successfully with valid handler', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/process',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createActionEvent()),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.actionId).toBe('action-1');
    });
  });

  describe('POST /internal/actions/retry-pending', () => {
    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/retry-pending',
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts Bearer token for OIDC auth (Cloud Scheduler)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/retry-pending',
        headers: {
          authorization: 'Bearer oidc-token',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts x-internal-auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/retry-pending',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns retry statistics', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/retry-pending',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.processed).toBe(5);
      expect(body.skipped).toBe(2);
      expect(body.failed).toBe(1);
      expect(body.total).toBe(8);
    });
  });

  describe('POST /internal/actions/approval-reply', () => {
    const createApprovalEvent = (
      overrides: Partial<ApprovalReplyEvent> = {}
    ): ApprovalReplyEvent => ({
      type: 'action.approval.reply',
      replyToWamid: 'wamid-1',
      userId: 'user-1',
      replyText: 'yes',
      timestamp: new Date().toISOString(),
      ...overrides,
    });

    const createPubSubPayload = (event: ApprovalReplyEvent): {
      message: { data: string; messageId: string; publishTime: string };
    } => ({
      message: {
        data: Buffer.from(JSON.stringify(event)).toString('base64'),
        messageId: 'msg-1',
        publishTime: '2025-01-01T12:00:00.000Z',
      },
    });

    it('returns 401 without auth (non-PubSub request)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        payload: createPubSubPayload(createApprovalEvent()),
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts PubSub push requests with from header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          from: 'noreply@google.com',
        },
        payload: createPubSubPayload(createApprovalEvent()),
      });

      expect(response.statusCode).toBe(200);
    });

    it('accepts x-internal-auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createApprovalEvent()),
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 400 for invalid base64 data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: {
          message: { data: 'not-valid-base64!!!', messageId: 'msg-1' },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid event type', async () => {
      const event = createApprovalEvent({ type: 'invalid.type' as ApprovalReplyEvent['type'] });
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when handler fails', async () => {
      const services = createFakeServices({
        actionServiceClient: new FakeActionServiceClient(),
        researchServiceClient: new FakeResearchServiceClient(),
        notificationSender: new FakeNotificationSender(),
        actionRepository: fakeActionRepository,
        actionEventPublisher: fakeActionEventPublisher,
        handleApprovalReplyUseCase: createFakeHandleApprovalReplyUseCase({
          failWithError: new Error('Handler failed'),
        }),
      });
      setServices(services);

      await app.close();
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createApprovalEvent()),
      });

      expect(response.statusCode).toBe(500);
    });

    it('processes approval reply successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(createApprovalEvent()),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.matched).toBe(true);
      expect(body.actionId).toBe('action-1');
      expect(body.intent).toBe('approve');
      expect(body.outcome).toBe('approved');
    });

    it('processes approval reply with actionId in event', async () => {
      const event = createApprovalEvent({
        actionId: 'action-2',
        replyText: 'no',
      });

      const services = createFakeServices({
        actionServiceClient: new FakeActionServiceClient(),
        researchServiceClient: new FakeResearchServiceClient(),
        notificationSender: new FakeNotificationSender(),
        actionRepository: fakeActionRepository,
        actionEventPublisher: fakeActionEventPublisher,
        handleApprovalReplyUseCase: createFakeHandleApprovalReplyUseCase({
          returnResult: {
            matched: true,
            actionId: 'action-2',
            intent: 'reject',
            outcome: 'rejected',
          },
        }),
      });
      setServices(services);

      await app.close();
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        matched: true,
        actionId: 'action-2',
        intent: 'reject',
        outcome: 'rejected',
      });
    });

    it('handles reply without actionId', async () => {
      const event = createApprovalEvent();
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete (event as Partial<ApprovalReplyEvent>).actionId;

      const services = createFakeServices({
        actionServiceClient: new FakeActionServiceClient(),
        researchServiceClient: new FakeResearchServiceClient(),
        notificationSender: new FakeNotificationSender(),
        actionRepository: fakeActionRepository,
        actionEventPublisher: fakeActionEventPublisher,
        handleApprovalReplyUseCase: createFakeHandleApprovalReplyUseCase({
          returnResult: {
            matched: true,
            intent: 'approve',
            outcome: 'approved',
          },
        }),
      });
      setServices(services);

      await app.close();
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/actions/approval-reply',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
        payload: createPubSubPayload(event),
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
