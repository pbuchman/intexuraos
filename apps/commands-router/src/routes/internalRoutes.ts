import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../services.js';
import { createProcessCommandUseCase } from '../domain/usecases/processCommand.js';
import type { CommandSourceType } from '../domain/models/command.js';

function validateInternalAuth(request: FastifyRequest): boolean {
  const internalAuthToken = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] ?? '';
  if (internalAuthToken === '') {
    request.log.warn('Internal auth failed: INTEXURAOS_INTERNAL_AUTH_TOKEN not configured');
    return false;
  }
  const authHeader = request.headers['x-internal-auth'];
  if (authHeader !== internalAuthToken) {
    request.log.warn('Internal auth failed: token mismatch');
    return false;
  }
  return true;
}

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
      if (!validateInternalAuth(request)) {
        reply.status(401);
        return { error: 'Unauthorized' };
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

      const services = getServices();
      const useCase = createProcessCommandUseCase({
        commandRepository: services.commandRepository,
        actionRepository: services.actionRepository,
        classifier: services.classifier,
      });

      const result = await useCase.execute({
        userId: eventData.userId,
        sourceType: eventData.sourceType,
        externalId: eventData.externalId,
        text: eventData.text,
        timestamp: eventData.timestamp,
      });

      request.log.info({ commandId: result.command.id, isNew: result.isNew }, 'Command processed');

      return {
        success: true,
        commandId: result.command.id,
        isNew: result.isNew,
      };
    }
  );

  done();
};
