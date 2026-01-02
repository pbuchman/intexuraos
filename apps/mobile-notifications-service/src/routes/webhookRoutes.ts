/**
 * Webhook routes for mobile-notifications-service.
 * POST /mobile-notifications/webhooks - Receive notification from mobile device.
 *
 * Logging strategy: Every step is logged for debugging and audit purposes.
 * - Request received: headers and body
 * - Signature validation: success or failure
 * - User lookup: found or not found
 * - Idempotency check: duplicate or new
 * - Save result: success or failure
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getServices } from '../services.js';
import { processNotification, type WebhookPayload } from '../domain/notifications/index.js';
import { webhookRequestSchema, webhookResponseSchema } from './schemas.js';

const SIGNATURE_HEADER = 'x-mobile-notifications-signature';

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: WebhookPayload }>(
    '/mobile-notifications/webhooks',
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
            description: 'Bad request (missing signature header)',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
          401: {
            description: 'Unauthorized (invalid signature)',
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
      const requestId = request.id;

      // Log incoming request with headers and body
      request.log.info(
        {
          requestId,
          headers: {
            'content-type': request.headers['content-type'],
            'x-mobile-notifications-signature':
              request.headers[SIGNATURE_HEADER] !== undefined ? '[PRESENT]' : '[MISSING]',
            'user-agent': request.headers['user-agent'],
          },
          body: {
            source: request.body.source,
            device: request.body.device,
            app: request.body.app,
            notification_id: request.body.notification_id,
            title: request.body.title,
            // Redact full text, just log length
            text_length: request.body.text.length,
          },
        },
        'Webhook request received'
      );

      // Check for signature header
      const signature = request.headers[SIGNATURE_HEADER];

      if (typeof signature !== 'string' || signature === '') {
        request.log.warn(
          { requestId, reason: 'missing_signature_header' },
          'Webhook rejected: missing signature header'
        );
        return await reply
          .code(400)
          .fail('INVALID_REQUEST', 'Missing X-Mobile-Notifications-Signature header');
      }

      request.log.info(
        { requestId, signatureLength: signature.length },
        'Signature header present, processing notification'
      );

      const services = getServices();
      const result = await processNotification(
        { signature, payload: request.body },
        services.signatureConnectionRepository,
        services.notificationRepository,
        request.log,
        services.notificationFiltersRepository
      );

      if (!result.ok) {
        request.log.error(
          { requestId, errorCode: result.error.code, errorMessage: result.error.message },
          'Webhook processing failed with internal error'
        );
        return await reply.fail(result.error.code, result.error.message);
      }

      // Check if rejected due to invalid signature - return 401
      if (result.value.status === 'ignored' && result.value.reason === 'invalid_signature') {
        request.log.warn(
          { requestId, status: result.value.status, reason: result.value.reason },
          'Webhook rejected: invalid signature'
        );
        return await reply.code(401).fail('UNAUTHORIZED', 'Invalid signature');
      }

      // Log final result
      request.log.info(
        {
          requestId,
          status: result.value.status,
          notificationId: result.value.id,
          reason: result.value.reason,
        },
        `Webhook processed: ${result.value.status}`
      );

      return await reply.ok(result.value);
    }
  );

  done();
};
