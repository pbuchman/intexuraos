import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { enrichBookmark } from '../domain/usecases/enrichBookmark.js';
import { summarizeBookmark } from '../domain/usecases/summarizeBookmark.js';
import type { EnrichBookmarkEvent } from '../infra/pubsub/enrichPublisher.js';
import type { SummarizeBookmarkEvent } from '../infra/pubsub/summarizePublisher.js';

interface PubSubPushMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export const pubsubRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/bookmarks/pubsub/enrich',
    {
      schema: {
        operationId: 'processEnrichBookmark',
        summary: 'Process bookmark enrichment event from PubSub',
        description:
          'Internal endpoint for PubSub push. Fetches link preview from web-agent and updates bookmark.',
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
            description: 'Enrichment completed',
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
        message: 'Received request to /internal/bookmarks/pubsub/enrich',
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
            'Internal auth failed for pubsub/enrich endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubPushMessage;

      let eventData: EnrichBookmarkEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as EnrichBookmarkEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        return { success: true };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'bookmarks.enrich') {
        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return { success: true };
      }

      request.log.info(
        {
          pubsubMessageId: body.message.messageId,
          bookmarkId: eventData.bookmarkId,
          userId: eventData.userId,
        },
        'Processing bookmark enrichment event'
      );

      const { bookmarkRepository, linkPreviewFetcher, summarizePublisher } = getServices();

      const result = await enrichBookmark(
        { bookmarkRepository, linkPreviewFetcher, summarizePublisher, logger: request.log },
        { bookmarkId: eventData.bookmarkId, userId: eventData.userId }
      );

      if (!result.ok) {
        request.log.warn(
          { bookmarkId: eventData.bookmarkId, error: result.error },
          'Bookmark enrichment failed'
        );
      } else {
        request.log.info(
          { bookmarkId: eventData.bookmarkId },
          'Bookmark enrichment completed successfully'
        );
      }

      return { success: true };
    }
  );

  fastify.post(
    '/internal/bookmarks/pubsub/summarize',
    {
      schema: {
        operationId: 'processSummarizeBookmark',
        summary: 'Process bookmark summarization event from PubSub',
        description:
          'Internal endpoint for PubSub push. Generates AI summary for bookmark using LLM.',
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
            description: 'Summarization completed',
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
        message: 'Received request to /internal/bookmarks/pubsub/summarize',
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
            'Internal auth failed for pubsub/summarize endpoint'
          );
          reply.status(401);
          return { error: 'Unauthorized' };
        }
      }

      const body = request.body as PubSubPushMessage;

      let eventData: SummarizeBookmarkEvent;
      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        eventData = JSON.parse(decoded) as SummarizeBookmarkEvent;
      } catch {
        request.log.error({ messageId: body.message.messageId }, 'Failed to decode PubSub message');
        return { success: true };
      }

      const parsedType = eventData.type as string;
      if (parsedType !== 'bookmarks.summarize') {
        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return { success: true };
      }

      request.log.info(
        {
          pubsubMessageId: body.message.messageId,
          bookmarkId: eventData.bookmarkId,
          userId: eventData.userId,
        },
        'Processing bookmark summarization event'
      );

      const { bookmarkRepository, bookmarkSummaryService, whatsAppSendPublisher } = getServices();

      const result = await summarizeBookmark(
        {
          bookmarkRepository,
          bookmarkSummaryService,
          ...(whatsAppSendPublisher !== undefined && { whatsAppSendPublisher }),
          logger: request.log,
        },
        { bookmarkId: eventData.bookmarkId, userId: eventData.userId }
      );

      if (!result.ok) {
        request.log.warn(
          { bookmarkId: eventData.bookmarkId, error: result.error },
          'Bookmark summarization failed'
        );
      } else {
        request.log.info(
          { bookmarkId: eventData.bookmarkId },
          'Bookmark summarization completed successfully'
        );
      }

      return { success: true };
    }
  );

  done();
};
