import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import {
  IngestPrivateWhatsAppEventsUseCase,
  type IngestPrivateWhatsAppEventsInput,
  type PrivateWhatsAppAggregateRebuildInput,
  type PrivateWhatsAppMessageQueryInput,
  type PrivateWhatsAppSenderDayQueryInput,
} from '../domain/whatsapp/index.js';
import { getServices } from '../services.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface PrivateMessagesQuerystring {
  sourceAccountId: string;
  senderKey?: string;
  from?: string;
  to?: string;
  eventDayKey?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateSenderDaysQuerystring {
  sourceAccountId: string;
  senderKey?: string;
  fromDay?: string;
  toDay?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateAggregateRebuildBody {
  sourceAccountId: string;
  from?: string;
  to?: string;
  limit?: number;
}

interface PrivateIngestBody extends Omit<IngestPrivateWhatsAppEventsInput, 'userId'> {
  userId?: string;
}

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

function getPrivateMessagesQueryLogMetadata(query: Partial<PrivateMessagesQuerystring>): Record<string, unknown> {
  return {
    route: 'internal_whatsapp_private_messages_query',
    hasSourceAccountId: typeof query.sourceAccountId === 'string',
    hasSenderKey: typeof query.senderKey === 'string',
    hasFrom: typeof query.from === 'string',
    hasTo: typeof query.to === 'string',
    hasEventDayKey: typeof query.eventDayKey === 'string',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

function getPrivateSenderDaysQueryLogMetadata(
  query: Partial<PrivateSenderDaysQuerystring>
): Record<string, unknown> {
  return {
    route: 'internal_whatsapp_private_sender_days_query',
    hasSourceAccountId: typeof query.sourceAccountId === 'string',
    hasSenderKey: typeof query.senderKey === 'string',
    hasFromDay: typeof query.fromDay === 'string',
    hasToDay: typeof query.toDay === 'string',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

function getPrivateAggregateRebuildLogMetadata(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') {
    return {
      route: 'internal_whatsapp_private_aggregates_rebuild',
      bodyType: typeof body,
    };
  }

  const payload = body as Partial<PrivateAggregateRebuildBody>;
  return {
    route: 'internal_whatsapp_private_aggregates_rebuild',
    hasSourceAccountId: typeof payload.sourceAccountId === 'string',
    hasFrom: typeof payload.from === 'string',
    hasTo: typeof payload.to === 'string',
    limit: normalizeLimit(payload.limit),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit === 'number') {
    return limit;
  }
  return 50;
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
          required: ['sourceAccountId', 'deliveryMode', 'events'],
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
          404: {
            description: 'Private WhatsApp account not found',
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
      const body = request.body as PrivateIngestBody;
      const accountResult =
        await services.privateWhatsAppRepository.getActiveAccountBySourceAccountId(
          body.sourceAccountId
        );
      if (!accountResult.ok) {
        return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
      }
      if (accountResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp source account is not active');
      }
      const useCase = new IngestPrivateWhatsAppEventsUseCase({
        privateWhatsAppRepository: services.privateWhatsAppRepository,
      });
      const result = await useCase.execute(
        {
          sourceAccountId: body.sourceAccountId,
          userId: accountResult.value.userId,
          deliveryMode: body.deliveryMode,
          events: body.events,
        },
        request.log
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Querystring: PrivateMessagesQuerystring }>(
    '/internal/whatsapp/private/messages',
    {
      attachValidation: true,
      schema: {
        operationId: 'getPrivateWhatsAppMessages',
        summary: 'Query private WhatsApp messages',
        description:
          'Internal endpoint for agents to read private WhatsApp messages by source account, sender, and time range.',
        tags: ['internal'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            senderKey: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            eventDayKey: { type: 'string', minLength: 10 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string', minLength: 1 },
          },
          required: ['sourceAccountId'],
        },
        response: {
          200: {
            description: 'Private WhatsApp messages retrieved',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                  nextCursor: { type: 'string' },
                },
                required: ['messages'],
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
    async (request: FastifyRequest<{ Querystring: PrivateMessagesQuerystring }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/messages',
        bodyPreviewLength: 0,
        additionalFields: getPrivateMessagesQueryLogMetadata(request.query),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp message query'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private WhatsApp message query'
        );
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const input: PrivateWhatsAppMessageQueryInput = {
        sourceAccountId: request.query.sourceAccountId,
        limit: normalizeLimit(request.query.limit),
      };
      if (request.query.senderKey !== undefined) {
        input.senderKey = request.query.senderKey;
      }
      if (request.query.from !== undefined) {
        input.from = request.query.from;
      }
      if (request.query.to !== undefined) {
        input.to = request.query.to;
      }
      if (request.query.eventDayKey !== undefined) {
        input.eventDayKey = request.query.eventDayKey;
      }
      if (request.query.cursor !== undefined) {
        input.cursor = request.query.cursor;
      }

      const result = await getServices().privateWhatsAppRepository.findMessages(input);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  fastify.get<{ Querystring: PrivateSenderDaysQuerystring }>(
    '/internal/whatsapp/private/sender-days',
    {
      attachValidation: true,
      schema: {
        operationId: 'getPrivateWhatsAppSenderDays',
        summary: 'Query private WhatsApp sender-day aggregates',
        description:
          'Internal endpoint for agents to read private WhatsApp daily sender aggregates for summaries.',
        tags: ['internal'],
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            senderKey: { type: 'string', minLength: 1 },
            fromDay: { type: 'string', minLength: 10 },
            toDay: { type: 'string', minLength: 10 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string', minLength: 1 },
          },
          required: ['sourceAccountId'],
        },
        response: {
          200: {
            description: 'Private WhatsApp sender-day aggregates retrieved',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  senderDays: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                  nextCursor: { type: 'string' },
                },
                required: ['senderDays'],
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
    async (
      request: FastifyRequest<{ Querystring: PrivateSenderDaysQuerystring }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/sender-days',
        bodyPreviewLength: 0,
        additionalFields: getPrivateSenderDaysQueryLogMetadata(request.query),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp sender-day query'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private WhatsApp sender-day query'
        );
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const input: PrivateWhatsAppSenderDayQueryInput = {
        sourceAccountId: request.query.sourceAccountId,
        limit: normalizeLimit(request.query.limit),
      };
      if (request.query.senderKey !== undefined) {
        input.senderKey = request.query.senderKey;
      }
      if (request.query.fromDay !== undefined) {
        input.fromDay = request.query.fromDay;
      }
      if (request.query.toDay !== undefined) {
        input.toDay = request.query.toDay;
      }
      if (request.query.cursor !== undefined) {
        input.cursor = request.query.cursor;
      }

      const result = await getServices().privateWhatsAppRepository.findSenderDays(input);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  fastify.post<{ Body: PrivateAggregateRebuildBody }>(
    '/internal/whatsapp/private/aggregates/rebuild',
    {
      attachValidation: true,
      schema: {
        operationId: 'rebuildPrivateWhatsAppAggregates',
        summary: 'Rebuild private WhatsApp sender aggregates',
        description:
          'Internal endpoint for agents to rebuild private WhatsApp sender and sender-day aggregate documents from stored messages.',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 5000, default: 1000 },
          },
          required: ['sourceAccountId'],
        },
        response: {
          200: {
            description: 'Private WhatsApp aggregate rebuild completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  scannedMessages: { type: 'number' },
                  upgradedMessages: { type: 'number' },
                  senderCount: { type: 'number' },
                  senderDayCount: { type: 'number' },
                },
                required: [
                  'scannedMessages',
                  'upgradedMessages',
                  'senderCount',
                  'senderDayCount',
                ],
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
    async (request: FastifyRequest<{ Body: PrivateAggregateRebuildBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/aggregates/rebuild',
        bodyPreviewLength: 0,
        additionalFields: getPrivateAggregateRebuildLogMetadata(request.body),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp aggregate rebuild'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private WhatsApp aggregate rebuild'
        );
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const input: PrivateWhatsAppAggregateRebuildInput = {
        sourceAccountId: request.body.sourceAccountId,
        limit: normalizeLimit(request.body.limit),
      };
      if (request.body.from !== undefined) {
        input.from = request.body.from;
      }
      if (request.body.to !== undefined) {
        input.to = request.body.to;
      }

      const result = await getServices().privateWhatsAppRepository.rebuildAggregates(input);
      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  done();
};
