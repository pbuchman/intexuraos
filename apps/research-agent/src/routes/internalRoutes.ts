import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { ActionCreatedEvent } from '../domain/models/actionEvent.js';

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
    '/internal/actions/research',
    {
      schema: {
        operationId: 'processResearchAction',
        summary: 'Process research action from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives research action events and processes them.',
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
      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: 'Received request to /internal/actions/research',
        bodyPreviewLength: 500,
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

      if (eventData.actionType !== 'research') {
        request.log.warn(
          {
            actionType: eventData.actionType,
            actionId: eventData.actionId,
            messageId: body.message.messageId,
          },
          'Unexpected action type'
        );
        reply.status(400);
        return { error: 'Invalid action type' };
      }

      const { handleResearchActionUseCase } = getServices();

      const result = await handleResearchActionUseCase.execute(eventData);

      if (!result.ok) {
        request.log.error({ err: result.error }, 'Failed to process research action');
        reply.status(500);
        return { error: result.error.message };
      }

      request.log.info(
        { actionId: eventData.actionId, researchId: result.value.researchId },
        'Research action processed'
      );

      return {
        success: true,
        researchId: result.value.researchId,
      };
    }
  );

  done();
};
