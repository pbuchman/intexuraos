/**
 * Pub/Sub Push Subscription Routes.
 * Receives Pub/Sub push messages for outbound WhatsApp messaging.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { MediaCleanupEvent, SendMessageEvent } from '../domain/inbox/index.js';
import { getErrorMessage } from '@intexuraos/common-core';

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

export const pubsubRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
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
      const isPubSubPush = request.headers['x-goog-pubsub-subscription-name'] !== undefined;

      if (isPubSubPush) {
        // Pub/Sub push: Cloud Run already validated OIDC token before request reached us
        request.log.info(
          { subscription: request.headers['x-goog-pubsub-subscription-name'] },
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
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
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
          phoneNumber: maskPhoneNumber(eventData.phoneNumber),
        },
        'Processing send message event'
      );

      const { messageSender } = getServices();
      const result = await messageSender.sendTextMessage(eventData.phoneNumber, eventData.message);

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
      const isPubSubPush = request.headers['x-goog-pubsub-subscription-name'] !== undefined;

      if (isPubSubPush) {
        // Pub/Sub push: Cloud Run already validated OIDC token before request reached us
        request.log.info(
          { subscription: request.headers['x-goog-pubsub-subscription-name'] },
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
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
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

  done();
};
