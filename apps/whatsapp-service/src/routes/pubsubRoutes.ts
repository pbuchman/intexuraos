/**
 * Pub/Sub Push Subscription Routes.
 * Receives Pub/Sub push messages for outbound WhatsApp messaging.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type {
  ExtractLinkPreviewsEvent,
  MediaCleanupEvent,
  SendMessageEvent,
  TranscribeAudioEvent,
  WebhookProcessEvent,
} from '../domain/whatsapp/index.js';
import { ExtractLinkPreviewsUseCase, TranscribeAudioUseCase } from '../domain/whatsapp/index.js';
import { getErrorMessage } from '@intexuraos/common-core';
import type { Config } from '../config.js';
import { processWebhookEvent } from './webhookRoutes.js';
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

/**
 * Creates Pub/Sub routes plugin with config.
 */
export function createPubsubRoutes(config: Config): FastifyPluginCallback {
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
            500: {
              description: 'Send failed',
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
            reply.status(401);
            return { error: 'Unauthorized' };
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
          reply.status(400);
          return { error: 'Invalid message format' };
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'whatsapp.message.send') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          reply.status(400);
          return { error: 'Invalid event type' };
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
          reply.status(500);
          return { error: 'Failed to look up phone number' };
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
          return { success: true };
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

        const { messageSender } = getServices();
        const result = await messageSender.sendTextMessage(phoneNumber, eventData.message);

        if (!result.ok) {
          request.log.error(
            {
              messageId: body.message.messageId,
              userId: eventData.userId,
              correlationId: eventData.correlationId,
              error: result.error.message,
            },
            'Failed to send WhatsApp message'
          );
          reply.status(500);
          return { error: result.error.message };
        }

        request.log.info(
          {
            messageId: body.message.messageId,
            userId: eventData.userId,
            correlationId: eventData.correlationId,
          },
          'Successfully sent WhatsApp message'
        );

        return { success: true };
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
                success: { type: 'boolean' },
                deletedCount: { type: 'number' },
              },
              required: ['success'],
            },
            400: {
              description: 'Invalid message format',
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
            500: {
              description: 'Cleanup failed',
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
            reply.status(401);
            return { error: 'Unauthorized' };
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
          reply.status(400);
          return { error: 'Invalid message format' };
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'whatsapp.media.cleanup') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          reply.status(400);
          return { error: 'Invalid event type' };
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

          return { success: true, deletedCount };
        } catch (error) {
          request.log.error(
            {
              pubsubMessageId: body.message.messageId,
              messageId: eventData.messageId,
              error: getErrorMessage(error),
            },
            'Unexpected error during media cleanup'
          );
          reply.status(500);
          return { error: 'Cleanup failed' };
        }
      }
    );

    fastify.post(
      '/internal/whatsapp/pubsub/transcribe-audio',
      {
        schema: {
          operationId: 'processTranscribeAudio',
          summary: 'Process audio transcription event from PubSub',
          description:
            'Internal endpoint for PubSub push. Receives transcription events and runs transcription synchronously.',
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
              description: 'Transcription completed',
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
          message: 'Received request to /internal/whatsapp/pubsub/transcribe-audio',
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
              'Internal auth failed for pubsub/transcribe-audio endpoint'
            );
            reply.status(401);
            return { error: 'Unauthorized' };
          }
        }

        const body = request.body as PubSubPushMessage;

        let eventData: TranscribeAudioEvent;
        try {
          const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
          eventData = JSON.parse(decoded) as TranscribeAudioEvent;
        } catch {
          request.log.error(
            { messageId: body.message.messageId },
            'Failed to decode PubSub message'
          );
          return { success: true };
        }

        const parsedType = eventData.type as string;
        if (parsedType !== 'whatsapp.audio.transcribe') {
          request.log.warn({ type: parsedType }, 'Unexpected event type');
          return { success: true };
        }

        request.log.info(
          {
            pubsubMessageId: body.message.messageId,
            messageId: eventData.messageId,
            userId: eventData.userId,
          },
          'Processing transcribe audio event'
        );

        const services = getServices();

        try {
          const transcribeUsecase = new TranscribeAudioUseCase({
            messageRepository: services.messageRepository,
            mediaStorage: services.mediaStorage,
            transcriptionService: services.transcriptionService,
            whatsappCloudApi: services.whatsappCloudApi,
            eventPublisher: services.eventPublisher,
          });

          await transcribeUsecase.execute(
            {
              messageId: eventData.messageId,
              userId: eventData.userId,
              gcsPath: eventData.gcsPath,
              mimeType: eventData.mimeType,
              userPhoneNumber: eventData.userPhoneNumber,
              originalWaMessageId: eventData.originalWaMessageId,
              phoneNumberId: eventData.phoneNumberId,
            },
            request.log
          );

          request.log.info(
            { messageId: eventData.messageId, userId: eventData.userId },
            'Transcription completed successfully'
          );
        } catch (error) {
          request.log.error(
            { messageId: eventData.messageId, error: getErrorMessage(error) },
            'Transcription failed'
          );
        }

        return { success: true };
      }
    );

    fastify.post(
      '/internal/whatsapp/pubsub/process-webhook',
      {
        schema: {
          operationId: 'processWebhookEvent',
          summary: 'Process webhook or link preview event from PubSub',
          description:
            'Internal endpoint for PubSub push. Handles two event types: webhook.process (processes WhatsApp webhook events) and linkpreview.extract (extracts Open Graph metadata from URLs in messages).',
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
            reply.status(401);
            return { error: 'Unauthorized' };
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
          return { success: true };
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

          try {
            const payload = JSON.parse(eventData.payload) as WebhookPayload;

            const mockRequest = {
              body: payload,
              log: request.log,
            } as FastifyRequest<{ Body: WebhookPayload }>;

            await processWebhookEvent(mockRequest, { id: eventData.eventId }, config);

            request.log.info({ eventId: eventData.eventId }, 'Webhook processing completed');
          } catch (error) {
            request.log.error(
              { eventId: eventData.eventId, error: getErrorMessage(error) },
              'Failed to process webhook event'
            );
          }

          return { success: true };
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

          return { success: true };
        }

        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return { success: true };
      }
    );

    done();
  };
}
