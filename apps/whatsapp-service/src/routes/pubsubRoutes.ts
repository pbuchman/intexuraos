/**
 * Pub/Sub Push Subscription Routes.
 * Receives Pub/Sub push messages for outbound WhatsApp messaging.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { getServices } from '../services.js';
import type {
  ConversationAssistantPreparationRequestedEvent,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  ExtractLinkPreviewsEvent,
  IntexMessageSourceType,
  MessageDigestDeliveryAuthorizationClient,
  MediaCleanupEvent,
  PrivateWhatsAppTranscriptionState,
  PrivateWhatsAppErasureWorkItem,
  SendMessageEvent,
  TranscriptionCompletedEvent,
  TranscriptionState,
  WhatsAppMessage,
  WhatsAppMessageDigestTemplate,
  WebhookProcessEvent,
} from '../domain/whatsapp/index.js';
import {
  ExtractLinkPreviewsUseCase,
  ProcessWebhookEventUseCase,
  WHATSAPP_MESSAGE_SEND_TIMEOUT_MS,
  shouldDeliverMessage,
} from '../domain/whatsapp/index.js';
import { getErrorMessage } from '@intexuraos/common-core';
import type { WebhookPayload } from './schemas.js';
import {
  conversationAssistantRandomIds,
  conversationAssistantSystemClock,
  prepareConversationAssistantSession,
} from '../domain/conversation-assistant/sessionUseCases.js';
import type { ConversationAssistantDeps } from '../domain/conversation-assistant/ports.js';
import { adaptConversationAssistantPreparationPublication } from '../domain/conversation-assistant/preparationPublisherAdapter.js';
import { prepareConversationAssistantContextAttachment } from '../domain/conversation-assistant/contextAttachmentUseCases.js';
import { processPrivateWhatsAppErasureBatch } from '../domain/whatsapp/usecases/privateWhatsAppErasure.js';

interface PubSubPushMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

function maskPhoneNumber(phone: string): string {
  if (phone.length <= 7) {
    return phone;
  }
  return phone.slice(0, -4) + '****';
}

function matrixDeliveryPayloadDigest(event: SendMessageEvent): string {
  const canonical = stableJson({
    version: 1,
    userId: event.userId,
    message: event.message,
    correlationId: event.correlationId,
    replyToMessageId: event.replyToMessageId ?? null,
    buttons: event.buttons ?? null,
    ctaUrl: event.ctaUrl ?? null,
    presentation: event.presentation ?? null,
    deliveryAuthorization: event.deliveryAuthorization ?? null,
    retainMessageText: event.retainMessageText ?? null,
    important: event.important ?? null,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function messageDigestDeliveryOwnerDigest(
  messageId: string,
  idempotencyKey: string,
  deliveryAttemptId: string
): string {
  return createHash('sha256')
    .update(
      stableJson({
        version: 1,
        consumer: 'whatsapp-service',
        messageId,
        idempotencyKey,
        deliveryAttemptId,
      }),
      'utf8'
    )
    .digest('hex');
}

const MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS = 1_024;
// Exact non-variable copy in the frozen template verified by the cutover preflight.
const MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS = 68;
const MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS = 80;
const MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS =
  MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_FIXED_BODY_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS;
const MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS = 80;
const MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS = 200;
const MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS = 88;
const MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS =
  MESSAGE_DIGEST_TEMPLATE_BODY_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_FIXED_BODY_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS -
  MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS;
const MESSAGE_DIGEST_EVENT_MESSAGE = 'Message Digest delivery';
const MESSAGE_DIGEST_RUN_URL_SUFFIX_PATTERN =
  /^#\/whatsapp\/message-digests\/md_[A-Za-z0-9_-]{3,120}\/history\/mdr_[A-Za-z0-9_-]{3,160}$/u;
const MESSAGE_DIGEST_DEFINITION_ID_PATTERN = /^md_[A-Za-z0-9_-]{3,120}$/u;
const MESSAGE_DIGEST_RUN_ID_PATTERN = /^mdr_[A-Za-z0-9_-]{3,160}$/u;
const MESSAGE_DIGEST_DELIVERY_AUTHORIZATION_SAFETY_MS = 5_000;

type ParsedMessageDigestPresentation =
  | { disposition: 'absent' }
  | {
      disposition: 'valid';
      value: {
        template: WhatsAppMessageDigestTemplate;
        authorization: {
          definitionId: string;
          runId: string;
        };
      };
    }
  | { disposition: 'invalid' };

function parseMessageDigestPresentation(event: SendMessageEvent): ParsedMessageDigestPresentation {
  const value = event.presentation as unknown;
  const authorizationValue = event.deliveryAuthorization as unknown;
  if (value === undefined && authorizationValue === undefined) return { disposition: 'absent' };
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    authorizationValue === null ||
    typeof authorizationValue !== 'object' ||
    Array.isArray(authorizationValue) ||
    event.message !== MESSAGE_DIGEST_EVENT_MESSAGE ||
    event.retainMessageText !== false ||
    event.important !== true ||
    typeof event.idempotencyKey !== 'string' ||
    event.idempotencyKey.trim() === '' ||
    event.replyToMessageId !== undefined ||
    event.buttons !== undefined ||
    event.ctaUrl !== undefined
  ) {
    return { disposition: 'invalid' };
  }
  const record = value as Record<string, unknown>;
  const authorization = authorizationValue as Record<string, unknown>;
  const template = parseMessageDigestTemplate(record);
  if (
    template === null ||
    typeof record['runUrlSuffix'] !== 'string' ||
    !MESSAGE_DIGEST_RUN_URL_SUFFIX_PATTERN.test(record['runUrlSuffix']) ||
    Object.keys(authorization).length !== 3 ||
    authorization['kind'] !== 'message_digest_delivery_v1' ||
    typeof authorization['definitionId'] !== 'string' ||
    !MESSAGE_DIGEST_DEFINITION_ID_PATTERN.test(authorization['definitionId']) ||
    typeof authorization['runId'] !== 'string' ||
    !MESSAGE_DIGEST_RUN_ID_PATTERN.test(authorization['runId']) ||
    record['runUrlSuffix'] !==
      `#/whatsapp/message-digests/${authorization['definitionId']}/history/${authorization['runId']}` ||
    event.idempotencyKey !== `message-digest:${authorization['runId']}`
  ) {
    return { disposition: 'invalid' };
  }
  return {
    disposition: 'valid',
    value: {
      template,
      authorization: {
        definitionId: authorization['definitionId'],
        runId: authorization['runId'],
      },
    },
  };
}

function parseMessageDigestTemplate(
  record: Record<string, unknown>
): WhatsAppMessageDigestTemplate | null {
  if (record['kind'] === 'message_digest_v1') {
    if (
      Object.keys(record).length !== 4 ||
      !isBoundedMessageDigestTemplateText(
        record['digestName'],
        MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS
      ) ||
      !isBoundedMessageDigestTemplateText(
        record['digestExcerpt'],
        MESSAGE_DIGEST_TEMPLATE_EXCERPT_MAX_CODE_POINTS
      ) ||
      typeof record['runUrlSuffix'] !== 'string'
    ) {
      return null;
    }
    return {
      digestName: record['digestName'],
      digestExcerpt: record['digestExcerpt'],
      runUrlSuffix: record['runUrlSuffix'],
    };
  }
  if (
    record['kind'] !== 'message_digest_v2' ||
    Object.keys(record).length !== 6 ||
    !isBoundedMessageDigestTemplateText(
      record['digestName'],
      MESSAGE_DIGEST_TEMPLATE_NAME_MAX_CODE_POINTS
    ) ||
    !isBoundedMessageDigestTemplateText(
      record['windowLabel'],
      MESSAGE_DIGEST_TEMPLATE_V2_WINDOW_LABEL_MAX_CODE_POINTS
    ) ||
    !isBoundedMessageDigestTemplateText(
      record['headline'],
      MESSAGE_DIGEST_TEMPLATE_V2_HEADLINE_MAX_CODE_POINTS
    ) ||
    !isBoundedMessageDigestMultilineText(
      record['digestBody'],
      MESSAGE_DIGEST_TEMPLATE_V2_BODY_MAX_CODE_POINTS
    ) ||
    typeof record['runUrlSuffix'] !== 'string'
  ) {
    return null;
  }
  return {
    kind: 'message_digest_v2',
    digestName: record['digestName'],
    windowLabel: record['windowLabel'],
    headline: record['headline'],
    digestBody: record['digestBody'],
    runUrlSuffix: record['runUrlSuffix'],
  };
}

export function isBoundedMessageDigestTemplateText(
  value: unknown,
  maxCodePoints: number
): value is string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.trim() !== value ||
    Array.from(value).length > maxCodePoints
  ) {
    return false;
  }
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return (
      codePoint === 10 ||
      codePoint === 13 ||
      (codePoint >= 0 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

function isBoundedMessageDigestMultilineText(
  value: unknown,
  maxCodePoints: number
): value is string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.trim() !== value ||
    Array.from(value).length > maxCodePoints
  ) {
    return false;
  }
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return (
      codePoint === 13 ||
      (codePoint >= 0 && codePoint <= 9) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortValue(nested)])
  );
}

const TRANSCRIPTION_FAILURE_REPLY =
  'I could not transcribe this voice message. Please try again or send text.';

function getTranscriptSourceType(
  eventData: TranscriptionCompletedEvent,
  message: WhatsAppMessage
): IntexMessageSourceType {
  const mediaKind = eventData.mediaKind ?? (message.mediaType === 'video' ? 'video' : 'audio');
  return mediaKind === 'video' ? 'whatsapp_video_transcript' : 'whatsapp_audio_transcript';
}

function formatTranscriptionReply(transcript: string): string {
  return `Transcription:\n${transcript}`;
}

async function sendTranscriptionReplyIfPossible(
  message: WhatsAppMessage,
  text: string,
  correlationId: string,
  request: FastifyRequest
): Promise<void> {
  const phoneNumberId = message.metadata?.phoneNumberId;
  if (phoneNumberId === undefined || phoneNumberId.trim() === '') {
    request.log.info(
      { userId: message.userId, messageId: message.id },
      'Skipping transcription reply because phoneNumberId metadata is missing'
    );
    return;
  }

  const { whatsappCloudApi, outboundMessageRepository } = getServices();
  const sendResult = await whatsappCloudApi.sendMessage(
    phoneNumberId,
    message.fromNumber,
    text,
    message.waMessageId
  );

  if (!sendResult.ok) {
    request.log.error(
      {
        userId: message.userId,
        messageId: message.id,
        waMessageId: message.waMessageId,
        error: sendResult.error.message,
      },
      'Failed to send transcription reply'
    );
    return;
  }

  const now = new Date();
  const ttlDays = 7;
  const expiresAt = Math.floor((now.getTime() + ttlDays * 24 * 60 * 60 * 1000) / 1000);
  const saveResult = await outboundMessageRepository.save({
    wamid: sendResult.value.messageId,
    correlationId,
    userId: message.userId,
    messageText: text,
    sentAt: now.toISOString(),
    expiresAt,
  });

  if (!saveResult.ok) {
    request.log.warn(
      {
        userId: message.userId,
        messageId: message.id,
        waMessageId: message.waMessageId,
        outboundWamid: sendResult.value.messageId,
        error: saveResult.error.message,
      },
      'Failed to save transcription reply for reply correlation'
    );
  }
}

async function showAgentTypingAfterTranscription(
  message: WhatsAppMessage,
  request: FastifyRequest
): Promise<void> {
  const phoneNumberId = message.metadata?.phoneNumberId;
  if (phoneNumberId === undefined || phoneNumberId.trim() === '') return;

  const result = await getServices().whatsappCloudApi.markAsReadWithTyping(
    phoneNumberId,
    message.waMessageId
  );
  if (!result.ok) {
    request.log.error(
      {
        userId: message.userId,
        messageId: message.id,
        waMessageId: message.waMessageId,
        error: result.error.message,
      },
      'Failed to show typing indicator after transcription'
    );
  }
}

/**
 * Creates Pub/Sub routes plugin with config.
 */
export function createPubsubRoutes(): FastifyPluginCallback {
  return (fastify, _opts, done) => {
    fastify.post(
      '/internal/whatsapp/pubsub/send-message',
      {
        schema: {
          operationId: 'processSendMessage',
          summary: 'Process send message event from PubSub',
          description:
            'Internal endpoint for PubSub push. Receives send message events and sends WhatsApp messages.',
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
              },
              required: ['success'],
            },
            400: {
              description: 'Invalid message format',
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
              description: 'Send failed',
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
        // Log incoming request BEFORE auth check (for debugging)
        logIncomingRequest(request, {
          message: 'Received request to /internal/whatsapp/pubsub/send-message',
          bodyPreviewLength: 0,
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
              'Internal auth failed for pubsub/send-message endpoint'
            );
            return await reply.fail(
              'UNAUTHORIZED',
              'Internal auth failed for pubsub/send-message endpoint'
            );
          }
        }

        const body = request.body as PubSubPushMessage;

        let eventData: SendMessageEvent;
        let rawEventJson = '';
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
          rawEventJson = decoded;
          eventData = JSON.parse(decoded) as SendMessageEvent;
        } catch {
          request.log.error(
            { messageId: body.message.messageId },
            'Failed to decode PubSub message'
          );
          return await reply.fail('INVALID_REQUEST', 'Failed to decode PubSub message');
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'whatsapp.message.send') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          return await reply.fail('INVALID_REQUEST', 'Unexpected event type');
        }

        const parsedMessageDigestPresentation = parseMessageDigestPresentation(eventData);
        if (parsedMessageDigestPresentation.disposition === 'invalid') {
          request.log.warn(
            {
              lane: 'message_digest',
              errorCode: 'INVALID_PRESENTATION',
              [SKIP_SENTRY_KEY]: true,
            },
            'Rejected invalid Message Digest WhatsApp presentation'
          );
          return await reply.ok({});
        }

        const idempotencyKey =
          typeof eventData.idempotencyKey === 'string' && eventData.idempotencyKey.trim() !== ''
            ? eventData.idempotencyKey
            : null;
        if (eventData.idempotencyKey !== undefined && idempotencyKey === null) {
          request.log.warn(
            {
              lane: 'matrix_corpus',
              errorCode: 'INVALID_IDEMPOTENCY_KEY',
              [SKIP_SENTRY_KEY]: true,
            },
            'Rejected invalid idempotent WhatsApp delivery'
          );
          return await reply.ok({});
        }
        const isMatrixDelivery = idempotencyKey !== null;

        if (typeof eventData.userId !== 'string' || eventData.userId.trim() === '') {
          request.log.warn(
            isMatrixDelivery
              ? { lane: 'matrix_corpus', errorCode: 'INVALID_USER_ID', [SKIP_SENTRY_KEY]: true }
              : {
                  messageId: body.message.messageId,
                  correlationId:
                    typeof eventData.correlationId === 'string'
                      ? eventData.correlationId
                      : undefined,
                  [SKIP_SENTRY_KEY]: true,
                },
            'Invalid send message event: userId is required'
          );
          return await reply.fail('INVALID_REQUEST', 'Invalid send message event');
        }

        request.log.info(
          isMatrixDelivery
            ? { lane: 'matrix_corpus' }
            : {
                messageId: body.message.messageId,
                userId: eventData.userId,
                correlationId: eventData.correlationId,
              },
          'Processing send message event'
        );

        const {
          messageSender,
          messageDigestDeliveryAuthorizationClient,
          notificationPreferencesRepository,
          outboundMessageRepository,
          userMappingRepository,
        } = getServices();
        const deliveryPayloadDigest =
          idempotencyKey === null
            ? null
            : parsedMessageDigestPresentation.disposition === 'valid'
              ? createHash('sha256').update(rawEventJson, 'utf8').digest('hex')
              : matrixDeliveryPayloadDigest(eventData);
        const deliveryStartedAt = new Date();
        const deliveryExpiresAt = Math.floor(
          (deliveryStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000
        );

        const recordTerminalFailure = async (
          key: string,
          payloadDigest: string,
          failureCode:
            | 'MAPPING_MISSING'
            | 'DISCONNECTED'
            | 'DELIVERY_DISABLED'
            | 'PROVIDER_REJECTED'
            | 'DELIVERY_AUTHORIZATION_REVOKED'
            | 'DELIVERY_AUTHORIZATION_UNAVAILABLE'
        ): Promise<boolean> => {
          const failed = await outboundMessageRepository.markIdempotentDeliveryFailed({
            idempotencyKey: key,
            payloadDigest,
            now: new Date().toISOString(),
            failureCode,
          });
          if (!failed.ok) {
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: failed.code,
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp terminal delivery receipt update failed'
            );
            return false;
          }
          return true;
        };

        let phoneNumber: string | null = null;
        let preflightFailure: 'MAPPING_MISSING' | 'DISCONNECTED' | 'DELIVERY_DISABLED' | null =
          null;
        if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
          const mappingResult = await userMappingRepository.getMapping(eventData.userId);
          if (!mappingResult.ok) {
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: 'PHONE_LOOKUP_FAILED',
                [SKIP_SENTRY_KEY]: true,
              },
              'Failed to look up phone number for Matrix delivery'
            );
            return await reply.fail('INTERNAL_ERROR', 'Failed to look up phone number');
          }

          if (mappingResult.value === null) {
            preflightFailure = 'MAPPING_MISSING';
          } else if (!mappingResult.value.connected) {
            preflightFailure = 'DISCONNECTED';
          } else {
            const firstPhoneNumber = mappingResult.value.phoneNumbers[0];
            if (firstPhoneNumber === undefined || firstPhoneNumber.trim() === '') {
              preflightFailure = 'MAPPING_MISSING';
            } else {
              phoneNumber = firstPhoneNumber;
            }
          }
        } else {
          const phoneResult = await userMappingRepository.findPhoneByUserId(eventData.userId);
          if (!phoneResult.ok) {
            request.log.error(
              {
                messageId: body.message.messageId,
                userId: eventData.userId,
                correlationId: eventData.correlationId,
                error: phoneResult.error.message,
              },
              'Failed to look up phone number for user'
            );
            return await reply.fail('INTERNAL_ERROR', 'Failed to look up phone number');
          }

          if (phoneResult.value === null) {
            request.log.warn(
              {
                messageId: body.message.messageId,
                userId: eventData.userId,
                correlationId: eventData.correlationId,
              },
              'User not connected to WhatsApp, skipping message'
            );
            return await reply.ok({});
          }
          phoneNumber = phoneResult.value;
        }

        if (phoneNumber !== null) {
          request.log.info(
            isMatrixDelivery
              ? { lane: 'matrix_corpus' }
              : {
                  messageId: body.message.messageId,
                  userId: eventData.userId,
                  phoneNumber: maskPhoneNumber(phoneNumber),
                },
            'Found phone number for user'
          );
        }

        const prefsResult = await notificationPreferencesRepository.getPreferences(
          eventData.userId
        );
        const level = prefsResult.ok ? prefsResult.value.notificationLevel : 'all';
        if (!prefsResult.ok) {
          request.log.warn(
            isMatrixDelivery
              ? {
                  lane: 'matrix_corpus',
                  errorCode: 'PREFERENCES_READ_FAILED',
                  [SKIP_SENTRY_KEY]: true,
                }
              : {
                  userId: eventData.userId,
                  correlationId: eventData.correlationId,
                  error: prefsResult.error.message,
                },
            'Failed to read notification preferences — falling back to deliver'
          );
        }
        if (!shouldDeliverMessage({ level, important: eventData.important })) {
          request.log.info(
            isMatrixDelivery
              ? { lane: 'matrix_corpus', level, important: eventData.important ?? false }
              : {
                  userId: eventData.userId,
                  correlationId: eventData.correlationId,
                  level,
                  important: eventData.important ?? false,
                },
            'Dropping non-important WhatsApp message per user preference'
          );
          if (idempotencyKey === null || deliveryPayloadDigest === null) {
            return await reply.ok({});
          }
          preflightFailure ??= 'DELIVERY_DISABLED';
        }

        let digestDeliveryAuthorization:
          | {
              identity: {
                userId: string;
                definitionId: string;
                runId: string;
                idempotencyKey: string;
                payloadDigest: string;
                ownerDigest: string;
              };
              fence: number;
              expiresAt: string;
              client: MessageDigestDeliveryAuthorizationClient;
            }
          | null = null;

        const releaseDigestDeliveryAuthorization = async (): Promise<boolean> => {
          if (digestDeliveryAuthorization === null) return true;
          const authorization = digestDeliveryAuthorization;
          digestDeliveryAuthorization = null;
          try {
            const released = await authorization.client.release({
              ...authorization.identity,
              fence: authorization.fence,
            });
            if (!released.ok) {
              request.log.error(
                {
                  lane: 'message_digest',
                  errorCode: 'DELIVERY_AUTHORIZATION_RELEASE_FAILED',
                  [SKIP_SENTRY_KEY]: true,
                },
                'Message Digest delivery authorization release failed'
              );
            }
            return released.ok;
          } catch {
            request.log.error(
              {
                lane: 'message_digest',
                errorCode: 'DELIVERY_AUTHORIZATION_RELEASE_FAILED',
                [SKIP_SENTRY_KEY]: true,
              },
              'Message Digest delivery authorization release failed'
            );
            return false;
          }
        };

        if (
          parsedMessageDigestPresentation.disposition === 'valid' &&
          idempotencyKey !== null &&
          deliveryPayloadDigest !== null
        ) {
          if (messageDigestDeliveryAuthorizationClient === undefined) {
            request.log.error(
              {
                lane: 'message_digest',
                errorCode: 'DELIVERY_AUTHORIZATION_UNAVAILABLE',
                [SKIP_SENTRY_KEY]: true,
              },
              'Message Digest delivery authorization is unavailable'
            );
            void reply.status(503);
            return await reply.ok({});
          }
          const identity = {
            userId: eventData.userId,
            definitionId: parsedMessageDigestPresentation.value.authorization.definitionId,
            runId: parsedMessageDigestPresentation.value.authorization.runId,
            idempotencyKey,
            payloadDigest: deliveryPayloadDigest,
            ownerDigest: messageDigestDeliveryOwnerDigest(
              body.message.messageId,
              idempotencyKey,
              randomUUID()
            ),
          };
          let acquired;
          try {
            acquired = await messageDigestDeliveryAuthorizationClient.acquire(identity);
          } catch {
            acquired = { ok: false as const, code: 'unavailable' as const };
          }
          if (!acquired.ok || acquired.disposition === 'busy') {
            request.log.warn(
              {
                lane: 'message_digest',
                errorCode: 'DELIVERY_AUTHORIZATION_RETRYABLE',
                [SKIP_SENTRY_KEY]: true,
              },
              'Message Digest delivery authorization is retryable'
            );
            void reply.status(503);
            return await reply.ok({});
          }
          if (acquired.disposition !== 'authorized') {
            request.log.info(
              { lane: 'message_digest', disposition: 'denied' },
              'Suppressed unauthorized Message Digest delivery'
            );
            return await reply.ok({});
          }
          digestDeliveryAuthorization = {
            identity,
            fence: acquired.fence,
            expiresAt: acquired.expiresAt,
            client: messageDigestDeliveryAuthorizationClient,
          };
        }

        try {
        if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
          const reservation = await outboundMessageRepository.reserveIdempotentDelivery({
            userId: eventData.userId,
            idempotencyKey,
            payloadDigest: deliveryPayloadDigest,
            now: deliveryStartedAt.toISOString(),
            expiresAt: deliveryExpiresAt,
          });
          if (!reservation.ok) {
            request.log.warn(
              {
                lane: 'matrix_corpus',
                errorCode: reservation.code,
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp delivery reservation rejected'
            );
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) {
              void reply.status(503);
              return await reply.ok({});
            }
            return reservation.code === 'PERSISTENCE_ERROR'
              ? await reply.fail('INTERNAL_ERROR', 'Delivery reservation failed')
              : await reply.ok({});
          }
          if (reservation.disposition !== 'acquired') {
            request.log.info(
              { lane: 'matrix_corpus', disposition: reservation.disposition },
              'Suppressed duplicate Matrix WhatsApp delivery'
            );
            if (reservation.disposition === 'duplicate_in_flight') {
              void reply.status(503);
            }
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) void reply.status(503);
            return await reply.ok({});
          }
          if (preflightFailure !== null) {
            const recorded = await recordTerminalFailure(
              idempotencyKey,
              deliveryPayloadDigest,
              preflightFailure
            );
            if (!recorded) void reply.status(503);
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) void reply.status(503);
            return await reply.ok({});
          }
        }

        const resolvedPhoneNumber = phoneNumber as string;

        if (digestDeliveryAuthorization !== null) {
          const authorization = digestDeliveryAuthorization;
          let renewalDisposition: 'authorized' | 'revoked' | 'unavailable' = 'unavailable';
          try {
            const renewed = await authorization.client.acquire(authorization.identity);
            if (renewed.ok && renewed.disposition === 'authorized') {
              digestDeliveryAuthorization = {
                identity: authorization.identity,
                fence: renewed.fence,
                expiresAt: renewed.expiresAt,
                client: authorization.client,
              };
              const minimumExpiry =
                Date.now() +
                WHATSAPP_MESSAGE_SEND_TIMEOUT_MS +
                MESSAGE_DIGEST_DELIVERY_AUTHORIZATION_SAFETY_MS;
              renewalDisposition =
                Date.parse(renewed.expiresAt) >= minimumExpiry ? 'authorized' : 'unavailable';
            } else if (renewed.ok && renewed.disposition === 'denied') {
              renewalDisposition = 'revoked';
            }
          } catch {
            renewalDisposition = 'unavailable';
          }

          if (renewalDisposition !== 'authorized') {
            const failureCode =
              renewalDisposition === 'revoked'
                ? 'DELIVERY_AUTHORIZATION_REVOKED'
                : 'DELIVERY_AUTHORIZATION_UNAVAILABLE';
            request.log.warn(
              {
                lane: 'message_digest',
                errorCode: failureCode,
                [SKIP_SENTRY_KEY]: true,
              },
              'Message Digest delivery authorization renewal failed closed'
            );
            const recorded = await recordTerminalFailure(
              authorization.identity.idempotencyKey,
              authorization.identity.payloadDigest,
              failureCode
            );
            if (!recorded || renewalDisposition === 'unavailable') void reply.status(503);
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) void reply.status(503);
            return await reply.ok({});
          }
        }

        let result;
        try {
          if (parsedMessageDigestPresentation.disposition === 'valid') {
            result = await messageSender.sendMessageDigestTemplate(
              resolvedPhoneNumber,
              parsedMessageDigestPresentation.value.template
            );
          } else if (eventData.ctaUrl !== undefined) {
            // Send CTA URL message (opens link in browser)
            result = await messageSender.sendCtaUrlMessage(
              resolvedPhoneNumber,
              eventData.message,
              eventData.ctaUrl
            );
          } else if (eventData.buttons !== undefined && eventData.buttons.length > 0) {
            // Send interactive message with reply buttons
            result = await messageSender.sendInteractiveMessage(
              resolvedPhoneNumber,
              eventData.message,
              eventData.buttons
            );
          } else {
            // Send plain text message
            result = await messageSender.sendTextMessage(resolvedPhoneNumber, eventData.message);
          }
        } catch {
          if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
            const ambiguous = await outboundMessageRepository.markIdempotentDeliveryAmbiguous({
              idempotencyKey,
              payloadDigest: deliveryPayloadDigest,
              now: new Date().toISOString(),
            });
            if (!ambiguous.ok) void reply.status(503);
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: ambiguous.ok ? 'AMBIGUOUS_EXTERNAL_EFFECT' : ambiguous.code,
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp delivery ended ambiguously'
            );
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) void reply.status(503);
            return await reply.ok({});
          }
          throw new Error('WhatsApp message sender threw');
        }

        if (!result.ok) {
          const isPermanentError =
            result.error.httpStatus !== undefined &&
            result.error.httpStatus >= 400 &&
            result.error.httpStatus < 500 &&
            result.error.httpStatus !== 429;

          if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
            if (isPermanentError) {
              const recorded = await recordTerminalFailure(
                idempotencyKey,
                deliveryPayloadDigest,
                'PROVIDER_REJECTED'
              );
              if (!recorded) void reply.status(503);
              request.log.error(
                {
                  lane: 'matrix_corpus',
                  errorCode: 'PROVIDER_REJECTED',
                  [SKIP_SENTRY_KEY]: true,
                },
                'Matrix WhatsApp delivery was rejected before an external effect'
              );
            } else {
              const ambiguous = await outboundMessageRepository.markIdempotentDeliveryAmbiguous({
                idempotencyKey,
                payloadDigest: deliveryPayloadDigest,
                now: new Date().toISOString(),
              });
              if (!ambiguous.ok) void reply.status(503);
              request.log.error(
                {
                  lane: 'matrix_corpus',
                  errorCode: ambiguous.ok ? 'AMBIGUOUS_EXTERNAL_EFFECT' : ambiguous.code,
                  [SKIP_SENTRY_KEY]: true,
                },
                'Matrix WhatsApp delivery ended ambiguously'
              );
            }
            const released = await releaseDigestDeliveryAuthorization();
            if (!released) void reply.status(503);
            return await reply.ok({});
          }

          if (isPermanentError) {
            request.log.error(
              {
                messageId: body.message.messageId,
                userId: eventData.userId,
                correlationId: eventData.correlationId,
                error: result.error.message,
                permanent: true,
              },
              'Failed to send WhatsApp message (permanent, will not retry)'
            );
            return await reply.ok({});
          }

          request.log.error(
            {
              messageId: body.message.messageId,
              userId: eventData.userId,
              correlationId: eventData.correlationId,
              error: result.error.message,
            },
            'Failed to send WhatsApp message'
          );
          return await reply.fail('DOWNSTREAM_ERROR', result.error.message);
        }

        const { wamid } = result.value;

        request.log.info(
          isMatrixDelivery
            ? { lane: 'matrix_corpus' }
            : {
                messageId: body.message.messageId,
                wamid,
                userId: eventData.userId,
                correlationId: eventData.correlationId,
              },
          'Successfully sent WhatsApp message'
        );

        // Store outbound message for reply correlation (best-effort, don't fail on error)
        const now = new Date();
        const TTL_DAYS = 7;
        const expiresAt = Math.floor((now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000) / 1000);

        const outboundMessage = {
          wamid,
          correlationId: eventData.correlationId,
          userId: eventData.userId,
          ...(eventData.retainMessageText === false ? {} : { messageText: eventData.message }),
          sentAt: now.toISOString(),
          expiresAt,
        };
        if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
          const completed = await outboundMessageRepository.completeIdempotentDelivery({
            idempotencyKey,
            payloadDigest: deliveryPayloadDigest,
            outboundMessage,
          });
          if (!completed.ok) {
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: completed.code,
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp delivery receipt completion failed'
            );
            void reply.status(503);
          }
          const released = await releaseDigestDeliveryAuthorization();
          if (!released) void reply.status(503);
          return await reply.ok({});
        }

        const saveResult = await outboundMessageRepository.save(outboundMessage);

        if (!saveResult.ok) {
          request.log.warn(
            {
              wamid,
              correlationId: eventData.correlationId,
              error: saveResult.error.message,
            },

            'Failed to save outbound message for reply correlation (non-fatal)'
          );
        } else {
          request.log.info(
            { wamid, correlationId: eventData.correlationId },
            'Saved outbound message for reply correlation'
          );
        }

        return await reply.ok({});
        } finally {
          const released = await releaseDigestDeliveryAuthorization();
          if (!released && !reply.sent) void reply.status(503);
        }
      }
    );

    fastify.post(
      '/internal/whatsapp/pubsub/media-cleanup',
      {
        schema: {
          operationId: 'processMediaCleanup',
          summary: 'Process media cleanup event from PubSub',
          description:
            'Internal endpoint for PubSub push. Receives media cleanup events and deletes GCS files.',
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
              description: 'Cleanup completed',
              type: 'object',
              properties: {
                success: { type: 'boolean', const: true },
                data: {
                  type: 'object',
                  properties: {
                    deletedCount: { type: 'number' },
                  },
                  required: ['deletedCount'],
                },
              },
              required: ['success', 'data'],
            },
            400: {
              description: 'Invalid message format',
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
              description: 'Cleanup failed',
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
        // Log incoming request BEFORE auth check (for debugging)
        logIncomingRequest(request, {
          message: 'Received request to /internal/whatsapp/pubsub/media-cleanup',
          bodyPreviewLength: 200,
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
              'Internal auth failed for pubsub/media-cleanup endpoint'
            );
            return await reply.fail(
              'UNAUTHORIZED',
              'Internal auth failed for pubsub/media-cleanup endpoint'
            );
          }
        }

        const body = request.body as PubSubPushMessage;

        let eventData: MediaCleanupEvent;
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
          eventData = JSON.parse(decoded) as MediaCleanupEvent;
        } catch {
          request.log.error(
            { messageId: body.message.messageId },
            'Failed to decode PubSub message'
          );
          return await reply.fail('INVALID_REQUEST', 'Failed to decode PubSub message');
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'whatsapp.media.cleanup') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          return await reply.fail('INVALID_REQUEST', 'Unexpected event type');
        }

        request.log.info(
          {
            pubsubMessageId: body.message.messageId,
            messageId: eventData.messageId,
            userId: eventData.userId,
            pathCount: eventData.gcsPaths.length,
          },
          'Processing media cleanup event'
        );

        const { mediaStorage } = getServices();
        let deletedCount = 0;

        try {
          for (const gcsPath of eventData.gcsPaths) {
            const result = await mediaStorage.delete(gcsPath);

            if (!result.ok) {
              request.log.warn(
                {
                  gcsPath,
                  error: result.error.message,
                },
                'Failed to delete file (continuing)'
              );
            } else {
              request.log.info({ gcsPath }, 'Deleted file');
              deletedCount++;
            }
          }

          request.log.info(
            {
              pubsubMessageId: body.message.messageId,
              messageId: eventData.messageId,
              deletedCount,
              totalCount: eventData.gcsPaths.length,
            },
            'Completed media cleanup'
          );

          return await reply.ok({ deletedCount });
        } catch (error) {
          request.log.error(
            {
              pubsubMessageId: body.message.messageId,
              messageId: eventData.messageId,
              error: getErrorMessage(error),
            },
            'Unexpected error during media cleanup'
          );
          return await reply.fail('INTERNAL_ERROR', 'Cleanup failed');
        }
      }
    );

    fastify.post(
      '/internal/whatsapp/pubsub/transcription-completed',
      {
        schema: {
          operationId: 'processTranscriptionCompleted',
          summary: 'Process completed transcription event from PubSub',
          description:
            'Internal endpoint for PubSub push. Receives transcription completion events, stores transcript state, replies on WhatsApp, and forwards completed transcripts to Intex.',
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
              description: 'Transcription completion acknowledged',
              type: 'object',
              properties: {
                success: { type: 'boolean' },
              },
              required: ['success'],
            },
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to /internal/whatsapp/pubsub/transcription-completed',
          bodyPreviewLength: 200,
        });

        const fromHeader = request.headers.from;
        const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

        if (isPubSubPush) {
          request.log.info(
            { from: fromHeader, userAgent: request.headers['user-agent'] },
            'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
          );
        } else {
          const authResult = validateInternalAuth(request);

          if (!authResult.valid) {
            request.log.warn(
              { reason: authResult.reason },
              'Internal auth failed for pubsub/transcription-completed endpoint'
            );
            return await reply.fail(
              'UNAUTHORIZED',
              'Internal auth failed for pubsub/transcription-completed endpoint'
            );
          }
        }

        const body = request.body as PubSubPushMessage;

        let eventData: TranscriptionCompletedEvent;
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
          const parsedEventData = JSON.parse(decoded) as Omit<
            TranscriptionCompletedEvent,
            'messageSource'
          > & {
            messageSource?: unknown;
          };
          if (
            parsedEventData.messageSource !== undefined &&
            parsedEventData.messageSource !== 'public_whatsapp' &&
            parsedEventData.messageSource !== 'private_whatsapp'
          ) {
            return await reply.fail('INVALID_REQUEST', 'Unexpected transcription message source');
          }
          eventData = parsedEventData as TranscriptionCompletedEvent;
        } catch {
          request.log.error(
            { messageId: body.message.messageId },
            'Failed to decode PubSub message'
          );
          return await reply.fail('INVALID_REQUEST', 'Failed to decode PubSub message');
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'srt.transcription.completed') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          return await reply.fail('INVALID_REQUEST', 'Unexpected event type');
        }

        const services = getServices();
        const { messageRepository, eventPublisher } = services;

        if (eventData.messageSource === 'private_whatsapp') {
          const privateMessageResult = await services.privateWhatsAppRepository.getMessageById(
            eventData.messageId
          );
          if (!privateMessageResult.ok) {
            request.log.error(
              {
                userId: eventData.userId,
                messageId: eventData.messageId,
                error: privateMessageResult.error.message,
              },
              'Failed to load private WhatsApp audio message for transcription completion'
            );
            return await reply.fail('INTERNAL_ERROR', 'Failed to load private audio message');
          }

          const privateMessage = privateMessageResult.value;
          if (privateMessage === null) {
            request.log.warn(
              {
                userId: eventData.userId,
                messageId: eventData.messageId,
                [SKIP_SENTRY_KEY]: true,
              },
              'Private WhatsApp audio message not found for transcription completion'
            );
            return await reply.ok({});
          }
          if (privateMessage.userId !== eventData.userId) {
            request.log.warn(
              {
                userId: eventData.userId,
                messageId: eventData.messageId,
                storedUserId: privateMessage.userId,
              },
              'Private WhatsApp audio message user mismatch for transcription completion'
            );
            return await reply.ok({});
          }

          const completedTranscript =
            eventData.status === 'completed' ? eventData.transcript?.trim() : undefined;
          if (
            eventData.status === 'completed' &&
            (completedTranscript === undefined || completedTranscript === '')
          ) {
            return await reply.fail(
              'INVALID_REQUEST',
              'Completed transcription is missing transcript'
            );
          }
          const completedTranscriptText = completedTranscript ?? '';

          const transcription: PrivateWhatsAppTranscriptionState =
            eventData.status === 'completed'
              ? {
                  status: 'completed',
                  jobId: eventData.jobId,
                  text: completedTranscriptText,
                  ...(eventData.summary !== undefined ? { summary: eventData.summary } : {}),
                  ...(eventData.detectedLanguage !== undefined
                    ? { detectedLanguage: eventData.detectedLanguage }
                    : {}),
                  completedAt: eventData.timestamp,
                }
              : {
                  status: 'failed',
                  jobId: eventData.jobId,
                  error: {
                    code: 'TRANSCRIPTION_FAILED',
                    message: eventData.error ?? 'Transcription failed',
                  },
                  completedAt: eventData.timestamp,
                };

          const updateResult = await services.privateWhatsAppRepository.updateMessageTranscription({
            userId: eventData.userId,
            messageId: eventData.messageId,
            transcription,
          });
          if (!updateResult.ok) {
            request.log.error(
              {
                userId: eventData.userId,
                messageId: eventData.messageId,
                error: updateResult.error.message,
              },
              'Failed to update private WhatsApp audio message transcription'
            );
            return await reply.fail('INTERNAL_ERROR', 'Failed to update private transcription');
          }

          request.log.info(
            {
              userId: eventData.userId,
              messageId: eventData.messageId,
              status: eventData.status,
              messageSource: eventData.messageSource,
            },
            'Processed private WhatsApp transcription completion event'
          );
          return await reply.ok({});
        }

        const messageResult = await messageRepository.findById(
          eventData.userId,
          eventData.messageId
        );

        if (!messageResult.ok) {
          request.log.error(
            {
              userId: eventData.userId,
              messageId: eventData.messageId,
              error: messageResult.error.message,
            },
            'Failed to load audio message for transcription completion'
          );
          return await reply.fail('INTERNAL_ERROR', 'Failed to load audio message');
        }

        const message = messageResult.value;
        if (message === null) {
          request.log.warn(
            {
              userId: eventData.userId,
              messageId: eventData.messageId,
              [SKIP_SENTRY_KEY]: true,
            },
            'Audio message not found for transcription completion'
          );
          return await reply.ok({});
        }

        const completedTranscript =
          eventData.status === 'completed' ? eventData.transcript?.trim() : undefined;
        if (
          eventData.status === 'completed' &&
          (completedTranscript === undefined || completedTranscript === '')
        ) {
          return await reply.fail(
            'INVALID_REQUEST',
            'Completed transcription is missing transcript'
          );
        }
        const completedTranscriptText = completedTranscript ?? '';

        const transcription: TranscriptionState =
          eventData.status === 'completed'
            ? {
                status: 'completed',
                jobId: eventData.jobId,
                text: completedTranscriptText,
                ...(eventData.summary !== undefined ? { summary: eventData.summary } : {}),
                completedAt: eventData.timestamp,
              }
            : {
                status: 'failed',
                jobId: eventData.jobId,
                error: {
                  code: 'TRANSCRIPTION_FAILED',
                  message: eventData.error ?? 'Transcription failed',
                },
                completedAt: eventData.timestamp,
              };

        const updateResult = await messageRepository.updateTranscription(
          eventData.userId,
          eventData.messageId,
          transcription
        );

        if (!updateResult.ok) {
          request.log.error(
            {
              userId: eventData.userId,
              messageId: eventData.messageId,
              error: updateResult.error.message,
            },
            'Failed to update audio message transcription'
          );
          return await reply.fail('INTERNAL_ERROR', 'Failed to update transcription');
        }

        if (eventData.status === 'completed') {
          const ingestPublishResult = await eventPublisher.publishIntexMessageIngest({
            type: 'intex.message.ingest',
            userId: eventData.userId,
            messageId: message.waMessageId,
            sourceType: getTranscriptSourceType(eventData, message),
            text: completedTranscriptText,
            whatsappSender: message.fromNumber,
            timestamp: eventData.timestamp,
          });

          if (!ingestPublishResult.ok) {
            request.log.error(
              {
                userId: eventData.userId,
                messageId: eventData.messageId,
                waMessageId: message.waMessageId,
                error: ingestPublishResult.error.message,
              },
              'Failed to publish completed audio transcript to Intex'
            );
            return await reply.fail('INTERNAL_ERROR', 'Failed to publish transcript to Intex');
          }

          await sendTranscriptionReplyIfPossible(
            message,
            formatTranscriptionReply(completedTranscriptText),
            `transcription:${eventData.messageId}:${eventData.jobId}`,
            request
          );
          await showAgentTypingAfterTranscription(message, request);
        } else {
          await sendTranscriptionReplyIfPossible(
            message,
            TRANSCRIPTION_FAILURE_REPLY,
            `transcription:${eventData.messageId}:${eventData.jobId}`,
            request
          );
        }

        request.log.info(
          {
            userId: eventData.userId,
            messageId: eventData.messageId,
            status: eventData.status,
          },
          'Processed transcription completion event'
        );
        return await reply.ok({});
      }
    );

    fastify.post(
      '/internal/whatsapp/pubsub/process-webhook',
      {
        schema: {
          operationId: 'processWebhookEvent',
          summary: 'Process queued WhatsApp service work',
          description:
            'Internal endpoint for PubSub push. Processes webhook, link preview, and Conversation Assistant preparation events.',
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
              description: 'Webhook processed',
              type: 'object',
              properties: {
                success: { type: 'boolean' },
              },
              required: ['success'],
            },
          },
        },
      },
      async (request: FastifyRequest, reply: FastifyReply) => {
        logIncomingRequest(request, {
          message: 'Received request to /internal/whatsapp/pubsub/process-webhook',
          bodyPreviewLength: 0,
        });

        const fromHeader = request.headers.from;
        const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

        if (isPubSubPush) {
          request.log.info(
            { from: fromHeader, userAgent: request.headers['user-agent'] },
            'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
          );
        } else {
          const authResult = validateInternalAuth(request);

          if (!authResult.valid) {
            request.log.warn(
              { reason: authResult.reason },
              'Internal auth failed for pubsub/process-webhook endpoint'
            );
            return await reply.fail(
              'UNAUTHORIZED',
              'Internal auth failed for pubsub/process-webhook endpoint'
            );
          }
        }

        const body = request.body as PubSubPushMessage;

        let eventData: WebhookProcessEvent;
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
          eventData = JSON.parse(decoded) as WebhookProcessEvent;
        } catch {
          request.log.error(
            { messageId: body.message.messageId },
            'Failed to decode PubSub message'
          );
          return await reply.ok({});
        }

        const parsedType = eventData.type as string;

        if (parsedType === 'whatsapp.private-account.erasure') {
          const erasureAuth = validateInternalAuth(request);
          if (!erasureAuth.valid) {
            request.log.warn(
              { reason: erasureAuth.reason },
              'Internal auth failed for private WhatsApp erasure work'
            );
            return await reply.fail(
              'UNAUTHORIZED',
              'Internal auth failed for private WhatsApp erasure work'
            );
          }
          const erasureEvent = eventData as unknown as PrivateWhatsAppErasureWorkItem;
          if (
            typeof erasureEvent.sourceAccountId !== 'string' ||
            erasureEvent.sourceAccountId.trim() === '' ||
            typeof erasureEvent.userId !== 'string' ||
            erasureEvent.userId.trim() === '' ||
            typeof erasureEvent.erasureRequestId !== 'string' ||
            erasureEvent.erasureRequestId.trim() === '' ||
            !Number.isInteger(erasureEvent.attempt) ||
            erasureEvent.attempt < 0
          ) {
            request.log.warn({ outcome: 'invalid' }, 'Invalid private WhatsApp erasure event');
            return await reply.ok({});
          }
          const services = getServices();
          if (
            services.privateWhatsAppErasureRepository === undefined ||
            services.privateWhatsAppErasurePublisher === undefined
          ) {
            return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure is not configured');
          }
          const result = await processPrivateWhatsAppErasureBatch(erasureEvent, {
            repository: services.privateWhatsAppErasureRepository,
            publisher: services.privateWhatsAppErasurePublisher,
            mediaStorage: services.mediaStorage,
            now: () => new Date().toISOString(),
            ...(services.conversationAssistantOperationalTelemetry === undefined
              ? {}
              : { telemetry: services.conversationAssistantOperationalTelemetry }),
          });
          if (!result.ok) {
            request.log.error(
              { outcome: 'retryable_failure', code: result.error.code },
              'Private WhatsApp erasure batch failed'
            );
            return await reply.fail('INTERNAL_ERROR', 'Private WhatsApp erasure batch failed');
          }
          request.log.info(
            { outcome: result.value.status },
            'Private WhatsApp erasure batch processed'
          );
          return await reply.ok({});
        }

        if (parsedType === 'whatsapp.conversation-assistant.context-attachment.prepare') {
          const attachmentEvent =
            eventData as unknown as ConversationAssistantContextAttachmentPreparationRequestedEvent;
          if (
            typeof attachmentEvent.userId !== 'string' ||
            attachmentEvent.userId.trim() === '' ||
            typeof attachmentEvent.sessionId !== 'string' ||
            attachmentEvent.sessionId.trim() === '' ||
            typeof attachmentEvent.sessionGenerationId !== 'string' ||
            attachmentEvent.sessionGenerationId.trim() === '' ||
            typeof attachmentEvent.attachmentId !== 'string' ||
            attachmentEvent.attachmentId.trim() === '' ||
            !Number.isInteger(attachmentEvent.attempt) ||
            attachmentEvent.attempt < 1
          ) {
            request.log.warn(
              { outcome: 'invalid' },
              'Invalid Conversation Assistant context attachment preparation event'
            );
            return await reply.ok({});
          }
          const services = getServices();
          if (
            services.conversationAssistantContextAttachmentRepository === undefined ||
            services.conversationAssistantContextAttachmentDeltaBuilder === undefined
          ) {
            return await reply.fail(
              'INTERNAL_ERROR',
              'Conversation Assistant services are not configured'
            );
          }
          try {
            const result = await prepareConversationAssistantContextAttachment(
              {
                userId: attachmentEvent.userId,
                sessionId: attachmentEvent.sessionId,
                attachmentId: attachmentEvent.attachmentId,
                sessionGenerationId: attachmentEvent.sessionGenerationId,
                attempt: attachmentEvent.attempt,
                claimId: randomUUID(),
              },
              {
                repository: services.conversationAssistantContextAttachmentRepository,
                deltaBuilder: services.conversationAssistantContextAttachmentDeltaBuilder,
                clock: conversationAssistantSystemClock,
                ...(services.conversationAssistantOperationalTelemetry === undefined
                  ? {}
                  : { telemetry: services.conversationAssistantOperationalTelemetry }),
              },
              request.log
            );
            request.log.info(
              { outcome: result.kind, attempt: attachmentEvent.attempt },
              'Conversation Assistant context attachment preparation completed'
            );
            if (result.kind === 'busy') {
              return await reply.fail(
                'INTERNAL_ERROR',
                'Context attachment preparation is still leased'
              );
            }
            return await reply.ok({});
          } catch {
            request.log.error(
              { outcome: 'retryable_persistence_failure' },
              'Conversation Assistant context attachment preparation failed'
            );
            return await reply.fail(
              'INTERNAL_ERROR',
              'Context attachment preparation persistence failed'
            );
          }
        }

        if (parsedType === 'whatsapp.conversation-assistant.prepare') {
          const preparationEvent =
            eventData as unknown as ConversationAssistantPreparationRequestedEvent;
          if (
            typeof preparationEvent.sessionId !== 'string' ||
            typeof preparationEvent.userId !== 'string' ||
            !Number.isInteger(preparationEvent.attempt) ||
            preparationEvent.attempt < 1
          ) {
            request.log.error(
              { messageId: body.message.messageId },
              'Invalid Conversation Assistant preparation event'
            );
            return await reply.ok({});
          }
          const services = getServices();
          if (
            services.conversationAssistantRepository === undefined ||
            services.llmClientFactory === undefined ||
            services.conversationAssistantModel === undefined
          ) {
            return await reply.fail(
              'INTERNAL_ERROR',
              'Conversation Assistant services are not configured'
            );
          }
          const deps: ConversationAssistantDeps = {
            repository: services.conversationAssistantRepository,
            privateWhatsAppRepository: services.privateWhatsAppRepository,
            llmClientFactory: services.llmClientFactory,
            preparationPublisher: {
              async publish(event) {
                return adaptConversationAssistantPreparationPublication(
                  await services.eventPublisher.publishConversationAssistantPreparation(event)
                );
              },
            },
            defaultModel: services.conversationAssistantModel,
            clock: conversationAssistantSystemClock,
            ids: conversationAssistantRandomIds,
            ...(services.conversationAssistantOperationalTelemetry === undefined
              ? {}
              : { telemetry: services.conversationAssistantOperationalTelemetry }),
          };
          if (services.pdfConversationExporter !== undefined) {
            deps.pdfExporter = services.pdfConversationExporter;
          }

          const result = await prepareConversationAssistantSession(
            {
              userId: preparationEvent.userId,
              sessionId: preparationEvent.sessionId,
              attempt: preparationEvent.attempt,
              ...(typeof preparationEvent.generationId === 'string'
                ? { generationId: preparationEvent.generationId }
                : {}),
            },
            deps
          );
          if (!result.ok) {
            request.log.error(
              {
                attempt: preparationEvent.attempt,
                code: result.error.code,
              },
              'Conversation Assistant preparation failed'
            );
            if (result.error.code === 'PERSISTENCE_ERROR') {
              return await reply.fail('INTERNAL_ERROR', result.error.message);
            }
            return await reply.ok({});
          }

          request.log.info(
            {
              attempt: preparationEvent.attempt,
              status: result.value.session.status,
            },
            'Conversation Assistant preparation completed'
          );
          return await reply.ok({});
        }

        if (parsedType === 'whatsapp.webhook.process') {
          request.log.info(
            {
              pubsubMessageId: body.message.messageId,
              eventId: eventData.eventId,
              phoneNumberId: eventData.phoneNumberId,
            },
            'Processing webhook event'
          );

          let payload: WebhookPayload;
          try {
            payload = JSON.parse(eventData.payload) as WebhookPayload;
          } catch (error) {
            request.log.error(
              { eventId: eventData.eventId, error: getErrorMessage(error) },
              'Failed to parse webhook event payload'
            );
            return await reply.ok({});
          }

          const services = getServices();

          const processWebhookEventUseCase = new ProcessWebhookEventUseCase({
            webhookEventRepository: services.webhookEventRepository,
            userMappingRepository: services.userMappingRepository,
            messageRepository: services.messageRepository,
            outboundMessageRepository: services.outboundMessageRepository,
            mediaStorage: services.mediaStorage,
            whatsappCloudApi: services.whatsappCloudApi,
            thumbnailGenerator: services.thumbnailGenerator,
            eventPublisher: services.eventPublisher,
            ...(services.matrixCorpus === undefined
              ? {}
              : { matrixCorpusIngress: services.matrixCorpus.ingress }),
          });

          const result = await processWebhookEventUseCase.execute(
            payload,
            { id: eventData.eventId },
            request.log
          );

          if (result?.ok === false && result.retryable) {
            request.log.error(
              { eventId: eventData.eventId, failureDetails: result.failureDetails },
              'Webhook processing failed with retryable error'
            );
            return await reply.fail('INTERNAL_ERROR', result.failureDetails);
          }

          request.log.info({ eventId: eventData.eventId }, 'Webhook processing completed');
          return await reply.ok({});
        }

        if (parsedType === 'whatsapp.linkpreview.extract') {
          const linkPreviewEvent = eventData as unknown as ExtractLinkPreviewsEvent;

          request.log.info(
            {
              pubsubMessageId: body.message.messageId,
              messageId: linkPreviewEvent.messageId,
              userId: linkPreviewEvent.userId,
            },
            'Processing link preview extraction event'
          );

          try {
            const services = getServices();
            const extractLinkPreviewsUseCase = new ExtractLinkPreviewsUseCase({
              messageRepository: services.messageRepository,
              linkPreviewFetcher: services.linkPreviewFetcher,
            });

            await extractLinkPreviewsUseCase.execute(
              {
                messageId: linkPreviewEvent.messageId,
                userId: linkPreviewEvent.userId,
                text: linkPreviewEvent.text,
              },
              request.log
            );

            request.log.info(
              { messageId: linkPreviewEvent.messageId },
              'Link preview extraction completed'
            );
          } catch (error) {
            request.log.error(
              { messageId: linkPreviewEvent.messageId, error: getErrorMessage(error) },
              'Failed to extract link previews'
            );
          }

          return await reply.ok({});
        }

        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return await reply.ok({});
      }
    );

    done();
  };
}
