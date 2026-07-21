/**
 * Pub/Sub Push Subscription Routes.
 * Receives Pub/Sub push messages for outbound WhatsApp messaging.
 */
import { createHash } from 'node:crypto';

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { getServices } from '../services.js';
import type {
  ConversationAssistantPreparationRequestedEvent,
  ConversationAssistantContextAttachmentPreparationRequestedEvent,
  ExtractLinkPreviewsEvent,
  IntexMessageSourceType,
  MediaCleanupEvent,
  PrivateWhatsAppTranscriptionState,
  PrivateWhatsAppErasureWorkItem,
  SendMessageEvent,
  TranscriptionCompletedEvent,
  TranscriptionState,
  WhatsAppMessage,
  WebhookProcessEvent,
} from '../domain/whatsapp/index.js';
import {
  ExtractLinkPreviewsUseCase,
  ProcessWebhookEventUseCase,
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
import { prepareConversationAssistantContextAttachment } from '../domain/conversation-assistant/contextAttachmentUseCases.js';
import { randomUUID } from 'node:crypto';
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
    important: event.important ?? null,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
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
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
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

        const { userMappingRepository } = getServices();
        const phoneResult = await userMappingRepository.findPhoneByUserId(eventData.userId);
        if (!phoneResult.ok) {
          request.log.error(
            isMatrixDelivery
              ? {
                  lane: 'matrix_corpus',
                  errorCode: 'PHONE_LOOKUP_FAILED',
                  [SKIP_SENTRY_KEY]: true,
                }
              : {
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
            isMatrixDelivery
              ? { lane: 'matrix_corpus' }
              : {
                  messageId: body.message.messageId,
                  userId: eventData.userId,
                  correlationId: eventData.correlationId,
                },
            'User not connected to WhatsApp, skipping message'
          );
          return await reply.ok({});
        }

        const phoneNumber = phoneResult.value;
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

        const { notificationPreferencesRepository } = getServices();
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
          return await reply.ok({});
        }

        const { messageSender, outboundMessageRepository } = getServices();
        const deliveryPayloadDigest =
          idempotencyKey === null ? null : matrixDeliveryPayloadDigest(eventData);
        const deliveryStartedAt = new Date();
        const deliveryExpiresAt = Math.floor(
          (deliveryStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000
        );
        if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
          const reservation = await outboundMessageRepository.reserveIdempotentDelivery({
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
            return await reply.ok({});
          }
        }

        let result;
        try {
          if (eventData.ctaUrl !== undefined) {
            // Send CTA URL message (opens link in browser)
            result = await messageSender.sendCtaUrlMessage(
              phoneNumber,
              eventData.message,
              eventData.ctaUrl
            );
          } else if (eventData.buttons !== undefined && eventData.buttons.length > 0) {
            // Send interactive message with reply buttons
            result = await messageSender.sendInteractiveMessage(
              phoneNumber,
              eventData.message,
              eventData.buttons
            );
          } else {
            // Send plain text message
            result = await messageSender.sendTextMessage(phoneNumber, eventData.message);
          }
        } catch {
          if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
            await outboundMessageRepository.markIdempotentDeliveryAmbiguous({
              idempotencyKey,
              payloadDigest: deliveryPayloadDigest,
              now: new Date().toISOString(),
            });
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: 'AMBIGUOUS_EXTERNAL_EFFECT',
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp delivery ended ambiguously'
            );
            return await reply.ok({});
          }
          throw new Error('WhatsApp message sender threw');
        }

        if (!result.ok) {
          if (idempotencyKey !== null && deliveryPayloadDigest !== null) {
            await outboundMessageRepository.markIdempotentDeliveryAmbiguous({
              idempotencyKey,
              payloadDigest: deliveryPayloadDigest,
              now: new Date().toISOString(),
            });
            request.log.error(
              {
                lane: 'matrix_corpus',
                errorCode: 'AMBIGUOUS_EXTERNAL_EFFECT',
                [SKIP_SENTRY_KEY]: true,
              },
              'Matrix WhatsApp delivery ended ambiguously'
            );
            return await reply.ok({});
          }
          const isPermanentError =
            result.error.httpStatus !== undefined &&
            result.error.httpStatus >= 400 &&
            result.error.httpStatus < 500 &&
            result.error.httpStatus !== 429;

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
          messageText: eventData.message,
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
            request.log.warn(
              { outcome: 'invalid' },
              'Invalid private WhatsApp erasure event'
            );
            return await reply.ok({});
          }
          const services = getServices();
          if (
            services.privateWhatsAppErasureRepository === undefined ||
            services.privateWhatsAppErasurePublisher === undefined
          ) {
            return await reply.fail(
              'INTERNAL_ERROR',
              'Private WhatsApp erasure is not configured'
            );
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

        if (
          parsedType ===
          'whatsapp.conversation-assistant.context-attachment.prepare'
        ) {
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
          const preparationEvent = eventData as unknown as ConversationAssistantPreparationRequestedEvent;
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
              publish: () => Promise.resolve({ ok: true as const, value: undefined }),
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
