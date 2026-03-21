import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { enrichBookmark } from '../domain/usecases/enrichBookmark.js';
import { summarizeBookmark } from '../domain/usecases/summarizeBookmark.js';
import type { EnrichBookmarkEvent } from '../domain/ports/enrichPublisher.js';
import type { SummarizeBookmarkEvent } from '../domain/ports/summarizePublisher.js';
import { authenticatePubSub, decodePubSubMessage } from './pubsubHelpers.js';

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

      const isAuthenticated = await authenticatePubSub(request, reply);
      if (!isAuthenticated) return;

      const decoded = decodePubSubMessage(request);
      if (decoded === null) {
        return await reply.ok({});
      }

      const parsedType = decoded.data.type;
      if (parsedType !== 'bookmarks.enrich') {
        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return await reply.ok({});
      }

      const eventData = decoded.data as EnrichBookmarkEvent;

      request.log.info(
        {
          pubsubMessageId: decoded.messageId,
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

      return await reply.ok({});
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
          503: {
            description: 'Transient error - retry with backoff',
            type: 'object',
            properties: {
              error: { type: 'string' },
              retryable: { type: 'boolean' },
            },
            required: ['error', 'retryable'],
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/bookmarks/pubsub/summarize',
        bodyPreviewLength: 200,
      });

      const isAuthenticated = await authenticatePubSub(request, reply);
      if (!isAuthenticated) return;

      const decoded = decodePubSubMessage(request);
      if (decoded === null) {
        return await reply.ok({});
      }

      const parsedType = decoded.data.type;
      if (parsedType !== 'bookmarks.summarize') {
        request.log.warn({ type: parsedType }, 'Unexpected event type');
        return await reply.ok({});
      }

      const eventData = decoded.data as SummarizeBookmarkEvent;

      request.log.info(
        {
          pubsubMessageId: decoded.messageId,
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
          whatsAppSendPublisher,
          logger: request.log,
        },
        { bookmarkId: eventData.bookmarkId, userId: eventData.userId }
      );

      if (!result.ok) {
        if (result.error.code === 'TRANSIENT_ERROR') {
          request.log.warn(
            { bookmarkId: eventData.bookmarkId, error: result.error },
            'Transient error during summarization - returning 503 for retry'
          );
          reply.status(503);
          // @allow-raw-return: PubSub retry contract requires specific 503 response with retryable flag
          return { error: result.error.message, retryable: true };
        }

        request.log.warn(
          { bookmarkId: eventData.bookmarkId, error: result.error },
          'Bookmark summarization failed (permanent)'
        );
      } else {
        request.log.info(
          { bookmarkId: eventData.bookmarkId },
          'Bookmark summarization completed successfully'
        );
      }

      return await reply.ok({});
    }
  );

  done();
};
