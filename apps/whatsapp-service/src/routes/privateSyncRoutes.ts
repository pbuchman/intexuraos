import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { projectPrivateConversationContext } from '../domain/conversation-assistant/transcriptFormatting.js';
import {
  BackfillPrivateWhatsAppStoredMediaUseCase,
  IngestPrivateWhatsAppEventsUseCase,
  type IngestPrivateWhatsAppEventsInput,
  type PrivateWhatsAppAggregateRebuildInput,
  type PrivateWhatsAppMediaInfo,
  type PrivateWhatsAppMessage,
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

interface PrivateMediaBackfillBody {
  sourceAccountId: string;
  messageId: string;
  media: PrivateWhatsAppMediaInfo;
}

interface PrivateConversationContextBody {
  userId: string;
  chatId: string;
  from: string;
  to: string;
  maxMessages?: number;
}

interface PrivateIngestBody extends Omit<IngestPrivateWhatsAppEventsInput, 'userId'> {
  userId?: string;
}

const CONVERSATION_CONTEXT_RAW_SCAN_LIMIT = 5000;

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

function getPrivateMediaBackfillLogMetadata(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') {
    return {
      route: 'internal_whatsapp_private_media_backfill',
      bodyType: typeof body,
    };
  }

  const payload = body as Partial<PrivateMediaBackfillBody>;
  const media = payload.media;
  return {
    route: 'internal_whatsapp_private_media_backfill',
    hasSourceAccountId: typeof payload.sourceAccountId === 'string',
    hasMessageId: typeof payload.messageId === 'string',
    hasMedia: typeof media === 'object',
    mediaStorageStatus:
      typeof media === 'object' && typeof media.storageStatus === 'string'
        ? media.storageStatus
        : 'unknown',
  };
}

function getPrivateConversationContextLogMetadata(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') {
    return {
      route: 'internal_whatsapp_private_conversation_context',
      bodyType: typeof body,
    };
  }

  const payload = body as Partial<PrivateConversationContextBody>;
  return {
    route: 'internal_whatsapp_private_conversation_context',
    hasUserId: typeof payload.userId === 'string',
    hasChatId: typeof payload.chatId === 'string',
    hasFrom: typeof payload.from === 'string',
    hasTo: typeof payload.to === 'string',
    maxMessages: normalizeConversationMaxMessages(payload.maxMessages),
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

function normalizeConversationMaxMessages(maxMessages: number | undefined): number {
  if (typeof maxMessages === 'number') {
    return maxMessages;
  }
  return 2000;
}

function hasValidIsoTimeRange(from: string, to: string): boolean {
  if (!isCanonicalIsoTimestamp(from) || !isCanonicalIsoTimestamp(to)) {
    return false;
  }
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs < toMs;
}

function isCanonicalIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
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
        eventPublisher: services.eventPublisher,
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

  fastify.post<{ Body: PrivateMediaBackfillBody }>(
    '/internal/whatsapp/private/media/backfill',
    {
      attachValidation: true,
      schema: {
        operationId: 'backfillPrivateWhatsAppStoredMedia',
        summary: 'Backfill stored private WhatsApp media',
        description:
          'Internal endpoint for a Matrix/mautrix bridge to attach stored media metadata to an existing private WhatsApp message.',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sourceAccountId: { type: 'string', minLength: 1 },
            messageId: { type: 'string', minLength: 1 },
            media: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mxcUri: { type: 'string', minLength: 1 },
                mimeType: { type: 'string', minLength: 1 },
                fileName: { type: 'string', minLength: 1 },
                sizeBytes: { type: 'number', minimum: 0 },
                width: { type: 'number', minimum: 0 },
                height: { type: 'number', minimum: 0 },
                durationMs: { type: 'number', minimum: 0 },
                sha256: { type: 'string', minLength: 1 },
                storageStatus: { type: 'string', const: 'stored' },
                gcsPath: { type: 'string', minLength: 1 },
                thumbnailGcsPath: { type: 'string', minLength: 1 },
                storedMimeType: { type: 'string', minLength: 1 },
                storedSizeBytes: { type: 'number', minimum: 0 },
                storedAt: { type: 'string', minLength: 1 },
              },
              required: ['mxcUri', 'storageStatus', 'gcsPath'],
            },
          },
          required: ['sourceAccountId', 'messageId', 'media'],
        },
        response: {
          200: {
            description: 'Private WhatsApp media backfill completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['updated', 'already_stored'] },
                  transcriptionPublished: { type: 'boolean' },
                },
                required: ['status', 'transcriptionPublished'],
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
            description: 'Private WhatsApp account or message not found',
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
    async (request: FastifyRequest<{ Body: PrivateMediaBackfillBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/media/backfill',
        bodyPreviewLength: 0,
        additionalFields: getPrivateMediaBackfillLogMetadata(request.body),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp media backfill'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private WhatsApp media backfill'
        );
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }

      const services = getServices();
      const accountResult =
        await services.privateWhatsAppRepository.getActiveAccountBySourceAccountId(
          request.body.sourceAccountId
        );
      if (!accountResult.ok) {
        return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
      }
      if (accountResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp source account is not active');
      }

      const useCase = new BackfillPrivateWhatsAppStoredMediaUseCase({
        privateWhatsAppRepository: services.privateWhatsAppRepository,
        eventPublisher: services.eventPublisher,
      });
      const result = await useCase.execute(
        {
          sourceAccountId: request.body.sourceAccountId,
          messageId: request.body.messageId,
          media: request.body.media,
        },
        request.log
      );
      if (!result.ok) {
        if (result.error.code === 'VALIDATION_ERROR') {
          return await reply.fail('INVALID_REQUEST', result.error.message);
        }
        if (result.error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', result.error.message);
        }
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

  fastify.post<{ Body: PrivateConversationContextBody }>(
    '/internal/whatsapp/private/conversation-context',
    {
      attachValidation: true,
      schema: {
        operationId: 'getPrivateWhatsAppConversationContext',
        summary: 'Export private WhatsApp conversation context',
        description:
          'Internal endpoint for agents to read sanitized text/transcript context for a user-owned private direct WhatsApp chat.',
        tags: ['internal'],
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string', minLength: 1 },
            chatId: { type: 'string', minLength: 1 },
            from: { type: 'string', minLength: 1 },
            to: { type: 'string', minLength: 1 },
            maxMessages: { type: 'integer', minimum: 1, maximum: 5000 },
          },
          required: ['userId', 'chatId', 'from', 'to'],
        },
        response: {
          200: {
            description: 'Private WhatsApp conversation context retrieved',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  chat: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      displayName: { type: 'string' },
                      chatType: { type: 'string', const: 'direct' },
                      firstSeenAt: { type: 'string' },
                      lastEventAt: { type: 'string' },
                      messageCount: { type: 'integer' },
                    },
                    required: ['id', 'chatType', 'firstSeenAt', 'lastEventAt', 'messageCount'],
                  },
                  range: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      from: { type: 'string' },
                      to: { type: 'string' },
                    },
                    required: ['from', 'to'],
                  },
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        id: { type: 'string' },
                        eventTimestamp: { type: 'string' },
                        importedAt: { type: 'string' },
                        direction: { type: 'string', enum: ['incoming', 'outgoing'] },
                        speakerLabel: { type: 'string' },
                        messageType: { type: 'string' },
                        contentKind: { type: 'string', enum: ['text', 'transcription'] },
                        content: { type: 'string' },
                      },
                      required: [
                        'id',
                        'eventTimestamp',
                        'importedAt',
                        'direction',
                        'speakerLabel',
                        'messageType',
                        'contentKind',
                        'content',
                      ],
                    },
                  },
                  omitted: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      mediaOnly: { type: 'integer' },
                      failedTranscriptions: { type: 'integer' },
                      pendingTranscriptions: { type: 'integer' },
                      nonText: { type: 'integer' },
                      overLimit: { type: 'integer' },
                    },
                    required: [
                      'mediaOnly',
                      'failedTranscriptions',
                      'pendingTranscriptions',
                      'nonText',
                      'overLimit',
                    ],
                  },
                  messageCount: { type: 'integer' },
                  transcriptSha256: { type: 'string' },
                },
                required: ['chat', 'range', 'messages', 'omitted', 'messageCount', 'transcriptSha256'],
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
            description: 'Private WhatsApp account or chat not found',
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
      request: FastifyRequest<{ Body: PrivateConversationContextBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/private/conversation-context',
        bodyPreviewLength: 0,
        additionalFields: getPrivateConversationContextLogMetadata(request.body),
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for private WhatsApp conversation context query'
        );
        return await reply.fail(
          'UNAUTHORIZED',
          'Internal auth failed for private WhatsApp conversation context query'
        );
      }

      const validatedRequest = request as ValidatedRequest;
      if (validatedRequest.validationError !== undefined) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
      }
      const maxMessages = normalizeConversationMaxMessages(request.body.maxMessages);
      if (!hasValidIsoTimeRange(request.body.from, request.body.to)) {
        return await reply.fail('INVALID_REQUEST', 'Invalid conversation context time range');
      }

      const repository = getServices().privateWhatsAppRepository;
      const accountResult = await repository.getAccountByUserId(request.body.userId);
      if (!accountResult.ok) {
        return await reply.fail('INTERNAL_ERROR', accountResult.error.message);
      }
      if (accountResult.value?.status !== 'active') {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp account not found');
      }

      const chatResult = await repository.getChatById({
        sourceAccountId: accountResult.value.sourceAccountId,
        chatId: request.body.chatId,
      });
      if (!chatResult.ok) {
        return await reply.fail('INTERNAL_ERROR', chatResult.error.message);
      }
      if (chatResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Private WhatsApp chat not found');
      }
      if (chatResult.value.chatType !== 'direct') {
        return await reply.fail('INVALID_REQUEST', 'Conversation context supports direct chats only');
      }

      const messages: PrivateWhatsAppMessage[] = [];
      let cursor: string | undefined;
      do {
        const query = {
          sourceAccountId: accountResult.value.sourceAccountId,
          chatId: request.body.chatId,
          from: request.body.from,
          to: request.body.to,
          limit: CONVERSATION_CONTEXT_RAW_SCAN_LIMIT,
          ...(cursor !== undefined ? { cursor } : {}),
        };
        const messagesResult = await repository.findConversationContextMessages(query);
        if (!messagesResult.ok) {
          return await reply.fail('INTERNAL_ERROR', messagesResult.error.message);
        }
        messages.push(...messagesResult.value.messages);
        cursor = messagesResult.value.nextCursor;
      } while (cursor !== undefined);

      return await reply.ok(
        projectPrivateConversationContext({
          chat: chatResult.value,
          range: { from: request.body.from, to: request.body.to },
          maxMessages,
          messages,
        })
      );
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
