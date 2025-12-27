/**
 * Webhook routes for mobile-notifications-service.
 * POST /v1/webhooks/mobile-notifications - Receive notification from mobile device.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { getServices } from '../../services.js';
import { processNotification, type WebhookPayload } from '../../domain/notifications/index.js';
import { webhookRequestSchema, webhookResponseSchema } from './schemas.js';

const SIGNATURE_HEADER = 'x-mobile-notifications-signature';

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: WebhookPayload }>(
    '/v1/webhooks/mobile-notifications',
    {
      schema: {
        operationId: 'receiveMobileNotification',
        summary: 'Receive mobile notification',
        description:
          'Webhook endpoint for mobile devices to send notifications. Requires X-Mobile-Notifications-Signature header.',
        tags: ['webhooks'],
        headers: {
          type: 'object',
          properties: {
            [SIGNATURE_HEADER]: { type: 'string' },
          },
        },
        body: webhookRequestSchema,
        response: {
          200: {
            description: 'Notification processed (accepted or ignored)',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: webhookResponseSchema,
            },
          },
          400: {
            description: 'Bad request (missing signature)',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
        },
      },
      // No authentication - uses signature header instead
    },
    async (request: FastifyRequest<{ Body: WebhookPayload }>, reply: FastifyReply) => {
      const signature = request.headers[SIGNATURE_HEADER];

      if (typeof signature !== 'string' || signature === '') {
        return await reply.fail(
          'INVALID_REQUEST',
          'Missing X-Mobile-Notifications-Signature header'
        );
      }

      const services = getServices();
      const result = await processNotification(
        { signature, payload: request.body },
        services.signatureConnectionRepository,
        services.notificationRepository
      );

      if (!result.ok) {
        return await reply.fail(result.error.code, result.error.message);
      }

      // Always return 200 OK with status indication
      return await reply.ok(result.value);
    }
  );

  done();
};
