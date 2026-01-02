import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';
import { getHandlerForType } from '../domain/usecases/actionHandlerRegistry.js';

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
              researchId: { type: 'string' },
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
        { actionId: eventData.actionId, actionType, researchId: result.value.researchId },
        'Action processed successfully'
      );

      return {
        success: true,
        researchId: result.value.researchId,
      };
    }
  );

  done();
};
