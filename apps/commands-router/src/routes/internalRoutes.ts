import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { CommandSourceType } from '../domain/models/command.js';
import type { ActionStatus } from '../domain/models/action.js';

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface CommandEvent {
  type: 'command.ingest';
  userId: string;
  sourceType: CommandSourceType;
  externalId: string;
  text: string;
  timestamp: string;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/router/commands',
    {
      schema: {
        operationId: 'ingestCommand',
        summary: 'Ingest command from PubSub',
        description:
          'Internal endpoint for PubSub push. Receives command events and processes them.',
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
              commandId: { type: 'string' },
              isNew: { type: 'boolean' },
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Log incoming request BEFORE auth check (for debugging)
      logIncomingRequest(request, {
        message: 'Received PubSub push to /internal/router/commands',
        bodyPreviewLength: 500,
      });

      // Pub/Sub push requests use OIDC tokens (validated by Cloud Run automatically)
      // Direct service calls use x-internal-auth header
      const isPubSubPush = request.headers['x-goog-pubsub-subscription-name'] !== undefined;

      // Diagnostic logging to debug Pub/Sub auth detection
      request.log.info(
        {
          isPubSubPush,
          hasPubSubHeader: request.headers['x-goog-pubsub-subscription-name'] !== undefined,
          headerValue: request.headers['x-goog-pubsub-subscription-name'],
          allGoogHeaders: Object.keys(request.headers)
            .filter((k) => k.startsWith('x-goog-'))
            .reduce((acc: Record<string, unknown>, k) => {
              acc[k] = request.headers[k];
              return acc;
            }, {}),
        },
        'Pub/Sub detection check'
      );

      if (isPubSubPush) {
        // Pub/Sub push: Cloud Run already validated OIDC token before request reached us
        // Just log that it's from Pub/Sub
        request.log.info(
          { subscription: request.headers['x-goog-pubsub-subscription-name'] },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        // Direct service call: validate x-internal-auth header
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            {
              reason: authResult.reason,
              headers: {
                'x-internal-auth':
                  request.headers['x-internal-auth'] !== undefined ? '[REDACTED]' : '[MISSING]',
              },
            },
            'Internal auth failed for router/commands endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubMessage;

      let eventData: CommandEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as CommandEvent;
      } catch {
        request.log.error({ data: body.message.data }, 'Failed to decode PubSub message');
        reply.status(400);
        return { error: 'Invalid message format' };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'command.ingest') {
        request.log.warn(
          {
            type: parsedType,
            externalId: eventData.externalId,
            userId: eventData.userId,
            messageId: body.message.messageId,
          },
          'Unexpected event type for commands endpoint'
        );
        reply.status(400);
        return { error: 'Invalid event type' };
      }

      request.log.info(
        {
          userId: eventData.userId,
          externalId: eventData.externalId,
          sourceType: eventData.sourceType,
          messageId: body.message.messageId,
          textPreview: eventData.text.substring(0, 50),
        },
        'Processing command ingest event'
      );

      const { processCommandUseCase } = getServices();

      const result = await processCommandUseCase.execute({
        userId: eventData.userId,
        sourceType: eventData.sourceType,
        externalId: eventData.externalId,
        text: eventData.text,
        timestamp: eventData.timestamp,
      });

      request.log.info(
        {
          commandId: result.command.id,
          isNew: result.isNew,
          userId: eventData.userId,
          externalId: eventData.externalId,
          status: result.command.status,
        },
        'Command processed successfully'
      );

      return {
        success: true,
        commandId: result.command.id,
        isNew: result.isNew,
      };
    }
  );

  fastify.patch(
    '/internal/actions/:actionId',
    {
      schema: {
        operationId: 'updateActionStatus',
        summary: 'Update action status',
        description: 'Internal endpoint for updating action status from workers.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            actionId: { type: 'string', description: 'Action ID to update' },
          },
          required: ['actionId'],
        },
        body: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'completed', 'failed'],
              description: 'New action status',
            },
            payload: {
              type: 'object',
              additionalProperties: true,
              description: 'Additional payload data to merge',
            },
          },
          required: ['status'],
        },
        response: {
          200: {
            description: 'Action updated successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
            },
            required: ['success'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
          404: {
            description: 'Action not found',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Log incoming request BEFORE auth check
      logIncomingRequest(request, {
        message: 'Received request to /internal/actions/:actionId',
        bodyPreviewLength: 200,
        includeParams: true,
      });

      // Validate auth (Pub/Sub uses OIDC, direct calls use x-internal-auth)
      const isPubSubPush = request.headers['x-goog-pubsub-subscription-name'] !== undefined;

      if (!isPubSubPush && !validateInternalAuth(request).valid) {
        request.log.warn('Internal auth failed for actions endpoint');
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { actionId } = request.params as { actionId: string };
      const { status, payload } = request.body as {
        status: ActionStatus;
        payload?: Record<string, unknown>;
      };

      const { actionRepository } = getServices();

      const action = await actionRepository.getById(actionId);
      if (action === null) {
        reply.status(404);
        return { error: 'Action not found' };
      }

      action.status = status;
      action.updatedAt = new Date().toISOString();
      if (payload !== undefined) {
        action.payload = { ...action.payload, ...payload };
      }

      await actionRepository.update(action);

      request.log.info({ actionId, status }, 'Action status updated');

      return { success: true };
    }
  );

  done();
};
