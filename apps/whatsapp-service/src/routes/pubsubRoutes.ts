/**
 * Pub/Sub Push Subscription Routes.
 * Receives Pub/Sub push messages for outbound WhatsApp messaging.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import { getServices } from '../services.js';
import type {
  ExtractLinkPreviewsEvent,
  MediaCleanupEvent,
  PrivateWhatsAppTranscriptionState,
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

const TRANSCRIPTION_FAILURE_REPLY =
  'I could not transcribe this voice message. Please try again or send text.';

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
              'Internal auth failed for pubsub/send-message endpoint'
            );
            return await reply.fail('UNAUTHORIZED', 'Internal auth failed for pubsub/send-message endpoint');
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

        if (typeof eventData.userId !== 'string' || eventData.userId.trim() === '') {
          request.log.warn(
            {
              messageId: body.message.messageId,
              correlationId:
                typeof eventData.correlationId === 'string' ? eventData.correlationId : undefined,
              [SKIP_SENTRY_KEY]: true,
            },
            'Invalid send message event: userId is required'
          );
          return await reply.fail('INVALID_REQUEST', 'Invalid send message event');
        }

        request.log.info(
          {
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

        const phoneNumber = phoneResult.value;
        request.log.info(
          {
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
            {
              userId: eventData.userId,
              correlationId: eventData.correlationId,
              error: prefsResult.error.message,
            },
            'Failed to read notification preferences — falling back to deliver'
          );
        }
        if (!shouldDeliverMessage({ level, important: eventData.important })) {
          request.log.info(
            {
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

        let result;
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

        if (!result.ok) {
          const isPermanentError = result.error.httpStatus !== undefined
            && result.error.httpStatus >= 400
            && result.error.httpStatus < 500
            && result.error.httpStatus !== 429;

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
          {
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
        const expiresAt = Math.floor(
          (now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000) / 1000
        );

        const saveResult = await outboundMessageRepository.save({
          wamid,
          correlationId: eventData.correlationId,
          userId: eventData.userId,
          messageText: eventData.message,
          sentAt: now.toISOString(),
          expiresAt,
        });

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
            return await reply.fail('UNAUTHORIZED', 'Internal auth failed for pubsub/media-cleanup endpoint');
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
          const privateMessageResult =
            await services.privateWhatsAppRepository.getMessageById(eventData.messageId);
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
          if (privateMessage?.userId !== eventData.userId) {
            request.log.warn(
              { userId: eventData.userId, messageId: eventData.messageId },
              'Private WhatsApp audio message not found for transcription completion'
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
            { userId: eventData.userId, messageId: eventData.messageId },
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
          return await reply.fail('INVALID_REQUEST', 'Completed transcription is missing transcript');
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
            sourceType: 'whatsapp_audio_transcript',
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
          summary: 'Process webhook event or trigger link preview extraction via web-agent',
          description:
            'Internal endpoint for PubSub push. Handles two event types: webhook.process (processes WhatsApp webhook events directly) and linkpreview.extract (delegates Open Graph metadata extraction to web-agent via internal API).',
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
              'Internal auth failed for pubsub/process-webhook endpoint'
            );
            return await reply.fail('UNAUTHORIZED', 'Internal auth failed for pubsub/process-webhook endpoint');
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
