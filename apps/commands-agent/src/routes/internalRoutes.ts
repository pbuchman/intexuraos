import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { CommandSourceType } from '../domain/models/command.js';

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
    '/internal/commands',
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
        message: 'Received PubSub push to /internal/commands',
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

  fastify.post(
    '/internal/retry-pending',
    {
      schema: {
        operationId: 'retryPendingClassifications',
        summary: 'Retry pending command classifications',
        description:
          'Internal endpoint called by Cloud Scheduler. Retries classification for commands in pending_classification status.',
        tags: ['internal'],
        response: {
          200: {
            description: 'Retry completed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              processed: { type: 'number', description: 'Commands successfully classified' },
              skipped: { type: 'number', description: 'Commands skipped (no API key)' },
              failed: { type: 'number', description: 'Commands that failed classification' },
              total: { type: 'number', description: 'Total pending commands found' },
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
        message: 'Received request to /internal/retry-pending',
        bodyPreviewLength: 200,
      });

      // Cloud Scheduler uses OIDC tokens validated by Cloud Run at infrastructure level.
      // If request has Authorization header, Cloud Run already validated the OIDC token.
      // Direct service calls use x-internal-auth header.
      const authHeader = request.headers.authorization;
      const isOidcAuth = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');

      if (isOidcAuth) {
        request.log.info('Authenticated via OIDC token (Cloud Scheduler)');
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn({ reason: authResult.reason }, 'Internal auth failed for retry-pending');
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const { retryPendingCommandsUseCase } = getServices();
      const result = await retryPendingCommandsUseCase.execute();

      request.log.info(result, 'Retry pending classifications completed');

      return { success: true, ...result };
    }
  );

  fastify.get(
    '/internal/commands/:commandId',
    {
      schema: {
        operationId: 'getCommandInternal',
        summary: 'Get command by ID (internal)',
        description: 'Internal endpoint for service-to-service command lookup.',
        tags: ['internal'],
        params: {
          type: 'object',
          properties: {
            commandId: { type: 'string' },
          },
          required: ['commandId'],
        },
        response: {
          200: {
            description: 'Command found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                properties: {
                  command: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      text: { type: 'string' },
                      sourceType: { type: 'string' },
                    },
                    required: ['id', 'text', 'sourceType'],
                  },
                },
                required: ['command'],
              },
            },
            required: ['success', 'data'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
          404: {
            description: 'Command not found',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /internal/commands/:commandId',
        bodyPreviewLength: 0,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn({ reason: authResult.reason }, 'Internal auth failed for get command');
        return await reply.fail('UNAUTHORIZED', 'Unauthorized');
      }

      const { commandId } = request.params as { commandId: string };
      const { commandRepository } = getServices();

      const command = await commandRepository.getById(commandId);
      if (command === null) {
        return await reply.fail('NOT_FOUND', 'Command not found');
      }

      return await reply.ok({
        command: {
          id: command.id,
          text: command.text,
          sourceType: command.sourceType,
        },
      });
    }
  );

  done();
};
