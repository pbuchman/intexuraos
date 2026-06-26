import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth, type AuthUser } from '@intexuraos/common-http';
import type {
  PrivateWhatsAppAccount,
  PrivateWhatsAppChat,
  PrivateWhatsAppChatQueryInput,
  PrivateWhatsAppMessage,
  PrivateWhatsAppMessageQueryInput,
  PrivateWhatsAppSender,
  PrivateWhatsAppSenderDay,
  PrivateWhatsAppSenderDayQueryInput,
  PrivateWhatsAppSenderQueryInput,
} from '../domain/whatsapp/index.js';
import { getServices } from '../services.js';
import { validatePhoneNumber } from './shared.js';

type ValidatedRequest = FastifyRequest & { validationError?: unknown };

interface PrivateSendersQuerystring {
  limit?: number;
  cursor?: string;
}

interface PrivateChatsQuerystring {
  limit?: number;
  cursor?: string;
}

interface PrivateMessagesQuerystring {
  senderKey: string;
  eventDayKey?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateChatMessagesQuerystring {
  eventDayKey?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateChatMessagesParams {
  chatId: string;
}

interface PrivateSenderDaysQuerystring {
  senderKey: string;
  fromDay?: string;
  toDay?: string;
  limit?: number;
  cursor?: string;
}

interface PrivateAccountBody {
  phoneNumber: string;
}

type PublicPrivateWhatsAppAccount = Omit<PrivateWhatsAppAccount, 'id' | 'userId'>;
type PublicPrivateWhatsAppChat = Omit<
  PrivateWhatsAppChat,
  'userId' | 'sourceAccountId' | 'matrixRoomId' | 'participantKeys'
>;
type PublicPrivateWhatsAppSender = Omit<PrivateWhatsAppSender, 'userId' | 'sourceAccountId'>;
type PublicPrivateWhatsAppMessage = Omit<
  PrivateWhatsAppMessage,
  | 'userId'
  | 'sourceAccountId'
  | 'rawMatrixEvent'
  | 'matrixRoomId'
  | 'matrixEventId'
  | 'matrixSenderId'
  | 'media'
> & {
  media?: Record<string, unknown>;
};
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
    404: privateReadErrorResponse('Private WhatsApp mirror not configured'),
    412: privateReadErrorResponse('Precondition failed'),
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

function getPublicChatsLogMetadata(query: Partial<PrivateChatsQuerystring>): Record<string, unknown> {
  return {
    route: 'whatsapp_private_chats_query',
    hasCursor: typeof query.cursor === 'string',
    limit: normalizeLimit(query.limit),
  };
}

function getPublicChatMessagesLogMetadata(
  query: Partial<PrivateChatMessagesQuerystring>,
  params: Partial<PrivateChatMessagesParams>
): Record<string, unknown> {
  return {
    route: 'whatsapp_private_chat_messages_query',
    hasChatId: typeof params.chatId === 'string',
    hasEventDayKey: typeof query.eventDayKey === 'string',
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
  reply: FastifyReply
): Promise<AuthUser | null> {
  const user = await requireAuth(request, reply);
  if (user === null) {
    return null;
  }
  return user;
}

async function resolveActivePrivateAccount(
  user: AuthUser,
  reply: FastifyReply
): Promise<PrivateWhatsAppAccount | null> {
  const result = await getServices().privateWhatsAppRepository.getAccountByUserId(user.userId);
  if (!result.ok) {
    await reply.fail('INTERNAL_ERROR', result.error.message);
    return null;
  }
  if (result.value?.status !== 'active') {
    await reply.fail('NOT_FOUND', 'Private WhatsApp mirror is not configured');
    return null;
  }
  return result.value;
}

function isConnectedPhone(mappingPhones: string[], phoneNumberNormalized: string): boolean {
  return mappingPhones.some((phone) => phone.replace(/\D/g, '') === phoneNumberNormalized);
}

function toPublicAccount(account: PrivateWhatsAppAccount): PublicPrivateWhatsAppAccount {
  return omitUndefined({
    sourceAccountId: account.sourceAccountId,
    phoneNumberNormalized: account.phoneNumberNormalized,
    displayName: account.displayName,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    lastIngestAt: account.lastIngestAt,
    lastEventAt: account.lastEventAt,
    messageCount: account.messageCount,
    senderCount: account.senderCount,
    schemaVersion: account.schemaVersion,
  }) as PublicPrivateWhatsAppAccount;
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

function toPublicChat(chat: PrivateWhatsAppChat): PublicPrivateWhatsAppChat {
  return omitUndefined({
    id: chat.id,
    chatType: chat.chatType,
    displayName: chat.displayName,
    avatarMxcUri: chat.avatarMxcUri,
    messageCount: chat.messageCount,
    participantCount: chat.participantCount,
    firstSeenAt: chat.firstSeenAt,
    lastEventAt: chat.lastEventAt,
    updatedAt: chat.updatedAt,
    schemaVersion: chat.schemaVersion,
  }) as PublicPrivateWhatsAppChat;
}

function toPublicMedia(
  media: PrivateWhatsAppMessage['media']
): Record<string, unknown> | undefined {
  if (media === undefined) return undefined;
  return omitUndefined({
    mxcUri: media.mxcUri,
    mimeType: media.mimeType,
    fileName: media.fileName,
    sizeBytes: media.sizeBytes,
    sha256: media.sha256,
    storageStatus: media.storageStatus,
    hasMedia: media.gcsPath !== undefined,
    hasThumbnail: media.thumbnailGcsPath !== undefined,
    storedMimeType: media.storedMimeType,
    storedSizeBytes: media.storedSizeBytes,
    storedAt: media.storedAt,
  });
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
    media: toPublicMedia(message.media),
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

export function createPrivateReadRoutes(): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.get(
      '/private/account',
      {
        schema: {
          operationId: 'getPrivateWhatsAppAccount',
          summary: 'Get private WhatsApp mirror account',
          tags: ['whatsapp'],
          response: {
            200: {
              description: 'Private WhatsApp mirror account retrieved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/account',
          bodyPreviewLength: 0,
          additionalFields: { route: 'whatsapp_private_account_get' },
        });
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }

        const result = await getServices().privateWhatsAppRepository.getAccountByUserId(user.userId);
        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        return await reply.ok(result.value === null ? null : toPublicAccount(result.value));
      }
    );

    fastify.put<{ Body: PrivateAccountBody }>(
      '/private/account',
      {
        attachValidation: true,
        schema: {
          operationId: 'upsertPrivateWhatsAppAccount',
          summary: 'Enable private WhatsApp mirror account',
          tags: ['whatsapp'],
          body: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phoneNumber: { type: 'string', minLength: 1 },
            },
            required: ['phoneNumber'],
          },
          response: {
            200: {
              description: 'Private WhatsApp mirror account saved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: { type: 'object', additionalProperties: true },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest<{ Body: PrivateAccountBody }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to PUT /whatsapp/private/account',
          bodyPreviewLength: 0,
          additionalFields: { route: 'whatsapp_private_account_put' },
        });
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }

        const phoneValidation = validatePhoneNumber(request.body.phoneNumber);
        if (!phoneValidation.valid) {
          return await reply.fail('INVALID_REQUEST', 'Invalid phone number format');
        }

        const services = getServices();
        const mappingResult = await services.userMappingRepository.getMapping(user.userId);
        if (!mappingResult.ok) {
          return await reply.fail('INTERNAL_ERROR', mappingResult.error.message);
        }
        if (
          mappingResult.value === null ||
          !mappingResult.value.connected ||
          !isConnectedPhone(mappingResult.value.phoneNumbers, phoneValidation.normalized)
        ) {
          return await reply.fail(
            'PRECONDITION_FAILED',
            'Private WhatsApp mirror requires a connected assistant phone'
          );
        }

        const result = await services.privateWhatsAppRepository.upsertAccount({
          userId: user.userId,
          phoneNumberNormalized: phoneValidation.normalized,
          displayName: `+${phoneValidation.normalized}`,
          now: new Date().toISOString(),
        });
        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        return await reply.ok(toPublicAccount(result.value));
      }
    );

    fastify.delete(
      '/private/account',
      {
        schema: {
          operationId: 'disablePrivateWhatsAppAccount',
          summary: 'Disable private WhatsApp mirror account',
          tags: ['whatsapp'],
          response: {
            200: {
              description: 'Private WhatsApp mirror account disabled successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: { type: 'object', additionalProperties: true },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to DELETE /whatsapp/private/account',
          bodyPreviewLength: 0,
          additionalFields: { route: 'whatsapp_private_account_delete' },
        });
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }

        const result = await getServices().privateWhatsAppRepository.disableAccount({
          userId: user.userId,
          now: new Date().toISOString(),
        });
        if (!result.ok) {
          if (result.error.code === 'NOT_FOUND') {
            return await reply.fail('NOT_FOUND', result.error.message);
          }
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        return await reply.ok(toPublicAccount(result.value));
      }
    );

    fastify.get<{ Querystring: PrivateChatsQuerystring }>(
      '/private/chats',
      {
        attachValidation: true,
        schema: {
          operationId: 'listPrivateWhatsAppChats',
          summary: 'List private WhatsApp chats',
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
              description: 'Private WhatsApp chats retrieved successfully',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    chats: { type: 'array', items: { type: 'object', additionalProperties: true } },
                    nextCursor: { type: 'string' },
                  },
                  required: ['chats'],
                },
              },
              required: ['success', 'data'],
            },
            ...privateReadErrorResponses(),
          },
        },
      },
      async (request: FastifyRequest<{ Querystring: PrivateChatsQuerystring }>, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/chats',
          bodyPreviewLength: 0,
          additionalFields: getPublicChatsLogMetadata(request.query),
        });
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }
        const account = await resolveActivePrivateAccount(user, reply);
        if (account === null) {
          return;
        }

        const input: PrivateWhatsAppChatQueryInput = {
          sourceAccountId: account.sourceAccountId,
          limit: normalizeLimit(request.query.limit),
        };
        if (request.query.cursor !== undefined) {
          input.cursor = request.query.cursor;
        }

        const result = await getServices().privateWhatsAppRepository.findChats(input);
        if (!result.ok) {
          return await reply.fail('INTERNAL_ERROR', result.error.message);
        }
        request.log.info(
          { route: 'whatsapp_private_chats_query', resultCount: result.value.chats.length },
          'Private WhatsApp chats retrieved'
        );
        const response: { chats: PublicPrivateWhatsAppChat[]; nextCursor?: string } = {
          chats: result.value.chats.map(toPublicChat),
        };
        if (result.value.nextCursor !== undefined) {
          response.nextCursor = result.value.nextCursor;
        }
        return await reply.ok(response);
      }
    );

    fastify.get<{
      Params: PrivateChatMessagesParams;
      Querystring: PrivateChatMessagesQuerystring;
    }>(
      '/private/chats/:chatId/messages',
      {
        attachValidation: true,
        schema: {
          operationId: 'listPrivateWhatsAppChatMessages',
          summary: 'List private WhatsApp messages by chat',
          tags: ['whatsapp'],
          params: {
            type: 'object',
            additionalProperties: false,
            properties: {
              chatId: { type: 'string', minLength: 1 },
            },
            required: ['chatId'],
          },
          querystring: {
            type: 'object',
            additionalProperties: false,
            properties: {
              eventDayKey: { type: 'string', minLength: 10 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
              cursor: { type: 'string', minLength: 1 },
            },
          },
          response: {
            200: {
              description: 'Private WhatsApp chat messages retrieved successfully',
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
      async (
        request: FastifyRequest<{
          Params: PrivateChatMessagesParams;
          Querystring: PrivateChatMessagesQuerystring;
        }>,
        reply: FastifyReply
      ) => {
        logIncomingRequest(request, {
          message: 'Received request to GET /whatsapp/private/chats/:chatId/messages',
          bodyPreviewLength: 0,
          additionalFields: getPublicChatMessagesLogMetadata(request.query, request.params),
        });
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }
        const account = await resolveActivePrivateAccount(user, reply);
        if (account === null) {
          return;
        }

        const input: PrivateWhatsAppMessageQueryInput = {
          sourceAccountId: account.sourceAccountId,
          chatId: request.params.chatId,
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
          {
            route: 'whatsapp_private_chat_messages_query',
            resultCount: result.value.messages.length,
          },
          'Private WhatsApp chat messages retrieved'
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
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }
        const account = await resolveActivePrivateAccount(user, reply);
        if (account === null) {
          return;
        }

        const input: PrivateWhatsAppSenderQueryInput = {
          sourceAccountId: account.sourceAccountId,
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
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }
        const account = await resolveActivePrivateAccount(user, reply);
        if (account === null) {
          return;
        }

        const input: PrivateWhatsAppMessageQueryInput = {
          sourceAccountId: account.sourceAccountId,
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
        const user = await requirePrivateWhatsAppOwner(request, reply);
        if (user === null) {
          return;
        }
        if (hasSourceAccountQuery(request)) {
          return await reply.fail('INVALID_REQUEST', 'sourceAccountId is server-side only');
        }
        const validatedRequest = request as ValidatedRequest;
        if (validatedRequest.validationError !== undefined) {
          return await reply.fail('INVALID_REQUEST', 'Validation failed');
        }
        const account = await resolveActivePrivateAccount(user, reply);
        if (account === null) {
          return;
        }

        const input: PrivateWhatsAppSenderDayQueryInput = {
          sourceAccountId: account.sourceAccountId,
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
