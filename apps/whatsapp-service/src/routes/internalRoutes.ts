import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import {
  authenticateInternalScheduler,
  validateInternalAuth,
  logIncomingRequest,
} from '@intexuraos/common-http';
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
        ...(services.notificationDeliveryRepository === undefined
          ? {}
          : { notificationDeliveryRepository: services.notificationDeliveryRepository }),
        mediaStorage: services.mediaStorage,
        whatsappCloudApi: services.whatsappCloudApi,
        thumbnailGenerator: services.thumbnailGenerator,
        eventPublisher: services.eventPublisher,
        ...(services.matrixCorpus === undefined
          ? {}
          : { matrixCorpusIngress: services.matrixCorpus.ingress }),
      });
      const retryPendingWebhookEventsUseCase = new RetryPendingWebhookEventsUseCase({
        webhookEventRepository: services.webhookEventRepository,
        processWebhookEventUseCase,
      });

      const heartbeat = services.jobHeartbeatStore;
      const token = await heartbeat?.start('retry_pending_whatsapp_webhooks');
      try {
        const result = await retryPendingWebhookEventsUseCase.execute(
          (request.body ?? {}) as RetryPendingWebhookEventsInput,
          request.log
        );

        if (token !== undefined)
          await heartbeat?.finish(token, result.failed === 0 ? 'succeeded' : 'failed');
        request.log.info(result, 'Pending WhatsApp webhook retry completed');
        return await reply.ok(result);
      } catch (error) {
        if (token !== undefined) await heartbeat?.finish(token, 'failed');
        throw error;
      }
    }
  );

  fastify.get(
    '/internal/monitoring/status',
    {
      schema: {
        operationId: 'getWhatsAppMonitoringStatus',
        tags: ['internal'],
        response: {
          200: {
            description: 'Scheduler and notification monitoring status',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: true },
              data: { type: 'object', additionalProperties: true },
            },
            required: ['success', 'data'],
          },
        },
      },
    },
    async (request, reply) => {
      logIncomingRequest(request, {
        message: 'Received scheduler monitoring request',
        bodyPreviewLength: 0,
      });
      if (!validateInternalAuth(request).valid)
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      const services = getServices();
      if (
        services.jobHeartbeatStore === undefined ||
        services.notificationDeliveryRepository === undefined
      )
        return await reply.fail('MISCONFIGURED', 'Monitoring services unavailable');
      const observedAt = new Date().toISOString();
      return await reply.ok({
        schemaVersion: 1,
        observedAt,
        jobs: await services.jobHeartbeatStore.list(['retry_pending_whatsapp_webhooks']),
        notifications: await services.notificationDeliveryRepository.monitoring(observedAt),
      });
    }
  );
  done();
};
