import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  IngestPrivateWhatsAppEventsUseCase,
  type IngestPrivateWhatsAppEventsInput,
} from '../domain/whatsapp/index.js';
import { getServices } from '../services.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

function getPrivateSyncLogMetadata(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') {
    return {
      route: 'internal_whatsapp_private_events',
      bodyType: typeof body,
    };
  }

  const payload = body as Record<string, unknown>;
  return {
    route: 'internal_whatsapp_private_events',
    deliveryMode: typeof payload['deliveryMode'] === 'string' ? payload['deliveryMode'] : 'unknown',
    eventCount: Array.isArray(payload['events']) ? payload['events'].length : 0,
    hasSourceAccountId: typeof payload['sourceAccountId'] === 'string',
    hasUserId: typeof payload['userId'] === 'string',
  };
}

export const privateSyncRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/whatsapp/private/events',
    {
      attachValidation: true,
      schema: {
        operationId: 'ingestPrivateWhatsAppEvents',
        summary: 'Ingest private WhatsApp events',
        description:
          'Internal endpoint for an external Matrix/mautrix bridge to synchronize private WhatsApp messages into Firestore.',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            userId: { type: 'string', minLength: 1 },
            deliveryMode: { type: 'string', enum: ['live', 'backfill'] },
            events: {
              type: 'array',
              minItems: 1,
              maxItems: 100,
              items: {},
            },
          },
          required: ['sourceAccountId', 'userId', 'deliveryMode', 'events'],
        },
        response: {
          200: {
            description: 'Private WhatsApp events ingested',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  accepted: { type: 'number' },
                  duplicates: { type: 'number' },
                  rejected: { type: 'number' },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        matrixEventId: { type: 'string' },
                        outcome: {
                          type: 'string',
                          enum: ['created', 'duplicate', 'rejected'],
                        },
                        chatId: { type: 'string' },
                        messageId: { type: 'string' },
                        reason: { type: 'string' },
                      },
                      required: ['matrixEventId', 'outcome'],
                    },
                  },
                },
                required: ['accepted', 'duplicates', 'rejected', 'messages'],
              },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Persistence failure',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/events',
        bodyPreviewLength: 0,
        additionalFields: getPrivateSyncLogMetadata(request.body),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp ingest'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for private WhatsApp ingest');
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const services = getServices();
      const useCase = new IngestPrivateWhatsAppEventsUseCase({
        privateWhatsAppRepository: services.privateWhatsAppRepository,
      });
      const result = await useCase.execute(
        request.body as IngestPrivateWhatsAppEventsInput,
        request.log
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
