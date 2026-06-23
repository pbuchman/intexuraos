import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import type {
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderDay,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderQueryInput,
} from '../domain/whatsapp/index.js';
import type { Config } from '../config.js';
import { getServices } from '../services.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface PrivateSendersQuerystring {
  limit?: number;
  cursor?: string;
}

interface PrivateMessagesQuerystring {
  senderKey: string;
  eventDayKey?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateSenderDaysQuerystring {
  senderKey: string;
  fromDay?: string;
  toDay?: string;
  limit?: number;
  cursor?: string;
}

type PublicPrivateWhatsAppSender = Omit<PrivateWhatsAppSender, 'userId' | 'sourceAccountId'>;
type PublicPrivateWhatsAppMessage = Omit<
  PrivateWhatsAppMessage,
  'userId' | 'sourceAccountId' | 'rawMatrixEvent' | 'matrixRoomId' | 'matrixEventId' | 'matrixSenderId'
>;
type PublicPrivateWhatsAppSenderDay = Omit<
  PrivateWhatsAppSenderDay,
  'userId' | 'sourceAccountId' | 'chatIds'
>;

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function privateReadErrorResponse(description: string): Record<string, unknown> {
  return {
    description,
    type: 'object',
    properties: {
      success: { type: 'boolean', const: false },
      error: { $ref: 'ErrorBody#' },
      diagnostics: { $ref: 'Diagnostics#' },
    },
    required: ['success', 'error'],
  };
}

function privateReadErrorResponses(): Record<number, Record<string, unknown>> {
  return {
    400: privateReadErrorResponse('Invalid request'),
    401: privateReadErrorResponse('Unauthorized - invalid or missing token'),
    403: privateReadErrorResponse('Forbidden - authenticated user is not the configured owner'),
    500: privateReadErrorResponse('Internal error'),
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit === 'number') {
    return limit;
  }
  return 50;
}

function hasSourceAccountQuery(request: FastifyRequest): boolean {
  return new URL(request.url, 'http://localhost').searchParams.has('sourceAccountId');
}

function getPublicSenderLogMetadata(query: Partial<PrivateSendersQuerystring>): Record<string, unknown> {
  return {
    route: 'whatsapp_private_senders_query',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

function getPublicMessagesLogMetadata(
  query: Partial<PrivateMessagesQuerystring>
): Record<string, unknown> {
  return {
    route: 'whatsapp_private_messages_query',
    hasSenderKey: typeof query.senderKey === 'string',
    hasEventDayKey: typeof query.eventDayKey === 'string',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

function getPublicSenderDaysLogMetadata(
  query: Partial<PrivateSenderDaysQuerystring>
): Record<string, unknown> {
  return {
    route: 'whatsapp_private_sender_days_query',
    hasSenderKey: typeof query.senderKey === 'string',
    hasFromDay: typeof query.fromDay === 'string',
    hasToDay: typeof query.toDay === 'string',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

async function requirePrivateWhatsAppOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  config: Config
): Promise<boolean> {
  const user = await requireAuth(request, reply);
  if (user === null) {
    return false;
  }
  if (user.userId !== config.privateWhatsappOwnerUserId) {
    request.log.warn({ route: 'whatsapp_private_read', ownerMatch: false }, 'Private WhatsApp owner check failed');
    await reply.fail('FORBIDDEN', 'Private WhatsApp access is restricted to the configured owner');
    return false;
  }
  return true;
}

function toPublicSender(sender: PrivateWhatsAppSender): PublicPrivateWhatsAppSender {
  return omitUndefined({
    id: sender.id,
    senderKey: sender.senderKey,
    senderDisplayName: sender.senderDisplayName,
    senderPhoneNumber: sender.senderPhoneNumber,
    senderPhoneNumberNormalized: sender.senderPhoneNumberNormalized,
    firstEventAt: sender.firstEventAt,
    lastEventAt: sender.lastEventAt,
    messageCount: sender.messageCount,
    chatIds: sender.chatIds,
    updatedAt: sender.updatedAt,
    schemaVersion: sender.schemaVersion,
  }) as PublicPrivateWhatsAppSender;
}

function toPublicMessage(message: PrivateWhatsAppMessage): PublicPrivateWhatsAppMessage {
  return omitUndefined({
    id: message.id,
    chatId: message.chatId,
    senderKey: message.senderKey,
    senderDisplayName: message.senderDisplayName,
    senderPhoneNumber: message.senderPhoneNumber,
    senderPhoneNumberNormalized: message.senderPhoneNumberNormalized,
    direction: message.direction,
    messageType: message.messageType,
    text: message.text,
    media: message.media,
    eventTimestamp: message.eventTimestamp,
    eventDayKey: message.eventDayKey,
    eventTimeZone: message.eventTimeZone,
    chatDisplayName: message.chatDisplayName,
    chatType: message.chatType,
    receivedAt: message.receivedAt,
    ingestedAt: message.ingestedAt,
    deliveryMode: message.deliveryMode,
    schemaVersion: message.schemaVersion,
  }) as PublicPrivateWhatsAppMessage;
}

function toPublicSenderDay(senderDay: PrivateWhatsAppSenderDay): PublicPrivateWhatsAppSenderDay {
  return omitUndefined({
    id: senderDay.id,
    senderKey: senderDay.senderKey,
    eventDayKey: senderDay.eventDayKey,
    eventTimeZone: senderDay.eventTimeZone,
    senderDisplayName: senderDay.senderDisplayName,
    senderPhoneNumber: senderDay.senderPhoneNumber,
    firstEventAt: senderDay.firstEventAt,
    lastEventAt: senderDay.lastEventAt,
    messageCount: senderDay.messageCount,
    messageTypeCounts: senderDay.messageTypeCounts,
    summaryStatus: senderDay.summaryStatus,
    summaryText: senderDay.summaryText,
    summaryGeneratedAt: senderDay.summaryGeneratedAt,
    summarySourceMessageCount: senderDay.summarySourceMessageCount,
    updatedAt: senderDay.updatedAt,
    schemaVersion: senderDay.schemaVersion,
  }) as PublicPrivateWhatsAppSenderDay;
}

export function createPrivateReadRoutes(config: Config): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.get<{ Querystring: PrivateSendersQuerystring }>(
      '/private/senders',
      {
        attachValidation: true,
        schema: {
          operationId: 'listPrivateWhatsAppSenders',
          summary: 'List private WhatsApp senders',
          tags: ['whatsapp'],
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              cursor: { type: 'string', minLength: 1 },
            },
          },
          response: {
            200: {
              description: 'Private WhatsApp senders retrieved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    senders: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    nextCursor: { type: 'string' },
                  },
                  required: ['senders'],
                },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: PrivateSendersQuerystring }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/senders',
          bodyPreviewLength: 0,
          additionalFields: getPublicSenderLogMetadata(request.query),
        });
        if (!(await requirePrivateWhatsAppOwner(request, reply, config))) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const input: PrivateWhatsAppSenderQueryInput = {
          sourceAccountId: config.privateWhatsappSourceAccountId,
          limit: normalizeLimit(request.query.limit),
        };
        if (request.query.cursor !== undefined) {
          input.cursor = request.query.cursor;
        }

        const result = await getServices().privateWhatsAppRepository.findSenders(input);
        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        request.log.info(
          { route: 'whatsapp_private_senders_query', resultCount: result.value.senders.length },
          'Private WhatsApp senders retrieved'
        );
        const response: { senders: PublicPrivateWhatsAppSender[]; nextCursor?: string } = {
          senders: result.value.senders.map(toPublicSender),
        };
        if (result.value.nextCursor !== undefined) {
          response.nextCursor = result.value.nextCursor;
        }
        return await reply.ok(response);
      }
    );

    fastify.get<{ Querystring: PrivateMessagesQuerystring }>(
      '/private/messages',
      {
        attachValidation: true,
        schema: {
          operationId: 'listPrivateWhatsAppMessages',
          summary: 'List private WhatsApp messages',
          tags: ['whatsapp'],
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              senderKey: { type: 'string', minLength: 1 },
              eventDayKey: { type: 'string', minLength: 10 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              cursor: { type: 'string', minLength: 1 },
            },
            required: ['senderKey'],
          },
          response: {
            200: {
              description: 'Private WhatsApp messages retrieved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    messages: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    nextCursor: { type: 'string' },
                  },
                  required: ['messages'],
                },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: PrivateMessagesQuerystring }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/messages',
          bodyPreviewLength: 0,
          additionalFields: getPublicMessagesLogMetadata(request.query),
        });
        if (!(await requirePrivateWhatsAppOwner(request, reply, config))) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const input: PrivateWhatsAppMessageQueryInput = {
          sourceAccountId: config.privateWhatsappSourceAccountId,
          senderKey: request.query.senderKey,
          limit: normalizeLimit(request.query.limit),
        };
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
        request.log.info(
          { route: 'whatsapp_private_messages_query', resultCount: result.value.messages.length },
          'Private WhatsApp messages retrieved'
        );
        const response: { messages: PublicPrivateWhatsAppMessage[]; nextCursor?: string } = {
          messages: result.value.messages.map(toPublicMessage),
        };
        if (result.value.nextCursor !== undefined) {
          response.nextCursor = result.value.nextCursor;
        }
        return await reply.ok(response);
      }
    );

    fastify.get<{ Querystring: PrivateSenderDaysQuerystring }>(
      '/private/sender-days',
      {
        attachValidation: true,
        schema: {
          operationId: 'listPrivateWhatsAppSenderDays',
          summary: 'List private WhatsApp sender days',
          tags: ['whatsapp'],
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              senderKey: { type: 'string', minLength: 1 },
              fromDay: { type: 'string', minLength: 10 },
              toDay: { type: 'string', minLength: 10 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              cursor: { type: 'string', minLength: 1 },
            },
            required: ['senderKey'],
          },
          response: {
            200: {
              description: 'Private WhatsApp sender days retrieved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    senderDays: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    nextCursor: { type: 'string' },
                  },
                  required: ['senderDays'],
                },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: PrivateSenderDaysQuerystring }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/sender-days',
          bodyPreviewLength: 0,
          additionalFields: getPublicSenderDaysLogMetadata(request.query),
        });
        if (!(await requirePrivateWhatsAppOwner(request, reply, config))) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const input: PrivateWhatsAppSenderDayQueryInput = {
          sourceAccountId: config.privateWhatsappSourceAccountId,
          senderKey: request.query.senderKey,
          limit: normalizeLimit(request.query.limit),
        };
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
        request.log.info(
          { route: 'whatsapp_private_sender_days_query', resultCount: result.value.senderDays.length },
          'Private WhatsApp sender days retrieved'
        );
        const response: { senderDays: PublicPrivateWhatsAppSenderDay[]; nextCursor?: string } = {
          senderDays: result.value.senderDays.map(toPublicSenderDay),
        };
        if (result.value.nextCursor !== undefined) {
          response.nextCursor = result.value.nextCursor;
        }
        return await reply.ok(response);
      }
    );

    done();
  };
}
