import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { authenticateInternalScheduler, logIncomingRequest } from '@intexuraos/common-http';
import {
  ProcessWebhookEventUseCase,
  RetryPendingWebhookEventsUseCase,
  type RetryPendingWebhookEventsInput,
} from '../domain/whatsapp/index.js';
import { getServices } from '../services.js';

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post(
    '/internal/whatsapp/webhooks/retry-pending',
    {
      attachValidation: true,
      schema: {
        operationId: 'retryPendingWhatsAppWebhooks',
        summary: 'Retry pending WhatsApp webhook events',
        description:
          'Internal endpoint called by Cloud Scheduler or an operator to drain persisted WhatsApp webhook events that did not complete async processing.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            eventIds: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
            limit: { type: 'number', minimum: 1, maximum: 100 },
            olderThanSeconds: { type: 'number', minimum: 0 },
            dryRun: { type: 'boolean' },
          },
        },
        response: {
          200: {
            description: 'Retry completed',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: {
                type: 'object',
                properties: {
                  processed: { type: 'number' },
                  skipped: { type: 'number' },
                  failed: { type: 'number' },
                  total: { type: 'number' },
                  events: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        eventId: { type: 'string' },
                        outcome: { type: 'string' },
                        status: { type: 'string' },
                        reason: { type: 'string' },
                      },
                      required: ['eventId', 'outcome'],
                    },
                  },
                },
                required: ['processed', 'skipped', 'failed', 'total', 'events'],
              },
            },
            required: ['success', 'data'],
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
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/whatsapp/webhooks/retry-pending',
        bodyPreviewLength: 300,
      });

      const authResult = authenticateInternalScheduler(request);
      if (!authResult.authenticated) {
        request.log.warn({ reason: 'auth_failed' }, 'Internal auth failed for webhook retry');
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for webhook retry');
      }

      if (
        (request as FastifyRequest & { validationError?: Error }).validationError !== undefined &&
        request.body !== undefined &&
        request.body !== null
      ) {
        return await reply.fail('INVALID_REQUEST', 'Validation failed');
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
      const retryPendingWebhookEventsUseCase = new RetryPendingWebhookEventsUseCase({
        webhookEventRepository: services.webhookEventRepository,
        processWebhookEventUseCase,
      });

      const result = await retryPendingWebhookEventsUseCase.execute(
        (request.body ?? {}) as RetryPendingWebhookEventsInput,
        request.log
      );

      request.log.info(result, 'Pending WhatsApp webhook retry completed');
      return await reply.ok(result);
    }
  );

  done();
};
