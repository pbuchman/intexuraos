import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getErrorMessage } from '@intexuraos/common-core';
import { getServices } from '../services.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { getHandlerForType } from '../domain/usecases/actionHandlerRegistry.js';
import { createAction } from '../domain/models/action.js';
import type { ActionType } from '../domain/models/action.js';

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/actions',
    {
      schema: {
        operationId: 'createAction',
        summary: 'Create new action',
        description:
          'Internal endpoint for creating actions. Called by commands-router after classification.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID who created the command' },
            commandId: { type: 'string', description: 'Command ID that triggered this action' },
            type: {
              type: 'string',
              enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
              description: 'Type of action',
            },
            title: { type: 'string', description: 'Action title' },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Classification confidence score',
            },
            payload: {
              type: 'object',
              additionalProperties: true,
              description: 'Optional action-specific payload',
            },
          },
          required: ['userId', 'commandId', 'type', 'title', 'confidence'],
        },
        response: {
          201: {
            description: 'Action created successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  commandId: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  status: { type: 'string' },
                  confidence: { type: 'number' },
                  payload: { type: 'object', additionalProperties: true },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/actions',
        bodyPreviewLength: 500,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for create action');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const body = request.body as {
        userId: string;
        commandId: string;
        type: ActionType;
        title: string;
        confidence: number;
        payload?: Record<string, unknown>;
      };

      const action = createAction({
        userId: body.userId,
        commandId: body.commandId,
        type: body.type,
        confidence: body.confidence,
        title: body.title,
      });

      if (body.payload !== undefined) {
        action.payload = body.payload;
      }

      request.log.info(
        {
          actionId: action.id,
          userId: body.userId,
          commandId: body.commandId,
          actionType: body.type,
        },
        'Creating new action'
      );

      const services = getServices();

      try {
        await services.actionRepository.save(action);

        request.log.info(
          {
            actionId: action.id,
            userId: body.userId,
            actionType: body.type,
          },
          'Action saved to Firestore'
        );

        try {
          await services.actionFiltersRepository.addOptions(body.userId, {
            status: action.status,
            type: action.type,
          });
          request.log.info({ userId: body.userId }, 'Filter options updated');
        } catch {
          request.log.warn(
            { userId: body.userId },
            'Failed to update filter options (non-critical)'
          );
        }
      } catch (error) {
        request.log.error(
          {
            actionId: action.id,
            error: getErrorMessage(error, 'Unknown error'),
          },
          'Failed to save action to Firestore'
        );
        reply.status(500);
        return { error: 'Failed to create action' };
      }

      const event: ActionCreatedEvent = {
        type: 'action.created',
        actionId: action.id,
        userId: body.userId,
        commandId: body.commandId,
        actionType: body.type,
        title: body.title,
        payload: {
          prompt: body.title,
          confidence: body.confidence,
        },
        timestamp: new Date().toISOString(),
      };

      request.log.info(
        {
          actionId: action.id,
          actionType: body.type,
        },
        'Publishing action.created event'
      );

      const publishResult = await services.actionEventPublisher.publishActionCreated(event);

      if (!publishResult.ok) {
        request.log.error(
          {
            actionId: action.id,
            error: publishResult.error.message,
          },
          'Failed to publish action.created event'
        );
      } else {
        request.log.info({ actionId: action.id }, 'Action event published successfully');
      }

      reply.status(201);
      return {
        success: true,
        data: action,
      };
    }
  );

  fastify.post(
    '/internal/actions/:actionType',
    {
      schema: {
        operationId: 'processAction',
        summary: 'Process action from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives action events and routes to appropriate handler.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            actionType: { type: 'string', description: 'Type of action to process' },
          },
          required: ['actionType'],
        },
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Message acknowledged',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              actionId: { type: 'string' },
            },
            required: ['success'],
          },
          400: {
            description: 'Invalid message',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Processing failed',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { actionType } = request.params as { actionType: string };

      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: `Received request to /internal/actions/${actionType}`,
        bodyPreviewLength: 500,
        includeParams: true,
      });

      // Pub/Sub push requests use OIDC tokens (validated by Cloud Run automatically)
      // Direct service calls use x-internal-auth header
      // Detection: Pub/Sub requests have from: noreply@google.com header
      const fromHeader = request.headers.from;
      const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

      if (isPubSubPush) {
        // Pub/Sub push: Cloud Run already validated OIDC token before request reached us
        request.log.info(
          {
            from: fromHeader,
            userAgent: request.headers['user-agent'],
          },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        // Direct service call: validate x-internal-auth header
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for actions/research endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let eventData: ActionCreatedEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as ActionCreatedEvent;
      } catch {
        request.log.error({ data: body.message.data }, 'Failed to decode PubSub message');
        reply.status(400);
        return { error: 'Invalid message format' };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'action.created') {
        request.log.warn(
          {
            type: parsedType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'Unexpected event type'
        );
        reply.status(400);
        return { error: 'Invalid event type' };
      }

      // Validate that URL actionType matches event actionType
      if (eventData.actionType !== actionType) {
        request.log.warn(
          {
            urlActionType: actionType,
            eventActionType: eventData.actionType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'Action type mismatch between URL and event'
        );
        reply.status(400);
        return { error: 'Action type mismatch' };
      }

      // Get handler for this action type
      const services = getServices();
      const handler = getHandlerForType(services, actionType);

      if (handler === undefined) {
        request.log.warn(
          {
            actionType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'No handler registered for action type'
        );
        reply.status(400);
        return { error: `Unsupported action type: ${actionType}` };
      }

      const result = await handler.execute(eventData);

      if (!result.ok) {
        request.log.error(
          { err: result.error, actionType, actionId: eventData.actionId },
          'Failed to process action'
        );
        reply.status(500);
        return { error: result.error.message };
      }

      request.log.info(
        { actionId: result.value.actionId, actionType },
        'Action processed successfully'
      );

      return {
        success: true,
        actionId: result.value.actionId,
      };
    }
  );

  fastify.post(
    '/internal/actions/process',
    {
      schema: {
        operationId: 'processActionUnified',
        summary: 'Process action from PubSub (unified)',
        description:
          'Unified internal endpoint for PubSub push. Accepts all action types and routes to appropriate handler if available.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Message acknowledged',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              actionId: { type: 'string' },
              skipped: { type: 'boolean' },
              reason: { type: 'string' },
            },
            required: ['success'],
          },
          400: {
            description: 'Invalid message',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Processing failed',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/actions/process',
        bodyPreviewLength: 500,
      });

      const fromHeader = request.headers.from;
      const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

      if (isPubSubPush) {
        request.log.info(
          {
            from: fromHeader,
            userAgent: request.headers['user-agent'],
          },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for /internal/actions/process'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let eventData: ActionCreatedEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as ActionCreatedEvent;
      } catch {
        request.log.error({ data: body.message.data }, 'Failed to decode PubSub message');
        reply.status(400);
        return { error: 'Invalid message format' };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'action.created') {
        request.log.warn(
          {
            type: parsedType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'Unexpected event type'
        );
        reply.status(400);
        return { error: 'Invalid event type' };
      }

      const services = getServices();
      const handler = getHandlerForType(services, eventData.actionType);

      if (handler === undefined) {
        request.log.info(
          {
            actionType: eventData.actionType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'No handler for action type, action stays in pending'
        );
        return {
          success: true,
          actionId: eventData.actionId,
          skipped: true,
          reason: 'no_handler',
        };
      }

      const result = await handler.execute(eventData);

      if (!result.ok) {
        request.log.error(
          { err: result.error, actionType: eventData.actionType, actionId: eventData.actionId },
          'Failed to process action'
        );
        reply.status(500);
        return { error: result.error.message };
      }

      request.log.info(
        { actionId: result.value.actionId, actionType: eventData.actionType },
        'Action processed successfully'
      );

      return {
        success: true,
        actionId: result.value.actionId,
      };
    }
  );

  fastify.post(
    '/internal/actions/retry-pending',
    {
      schema: {
        operationId: 'retryPendingActions',
        summary: 'Retry pending actions',
        description:
          'Internal endpoint called by Cloud Scheduler to retry actions stuck in pending status.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Retry completed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              processed: { type: 'number' },
              skipped: { type: 'number' },
              failed: { type: 'number' },
              total: { type: 'number' },
            },
            required: ['success', 'processed', 'skipped', 'failed', 'total'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/actions/retry-pending',
      });

      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for /internal/actions/retry-pending'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const services = getServices();
      const result = await services.retryPendingActionsUseCase.execute();

      request.log.info(result, 'Retry pending actions completed');

      return {
        success: true,
        ...result,
      };
    }
  );

  done();
};
