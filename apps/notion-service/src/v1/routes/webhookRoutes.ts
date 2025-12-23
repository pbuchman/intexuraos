/**
 * Webhook Routes
 *
 * POST /v1/webhooks/notion - Receive Notion webhooks (no auth required)
 */

import type { FastifyPluginCallback } from 'fastify';
import { webhookRequestSchema } from '../schemas.js';
import { handleValidationError } from './shared.js';

export const webhookRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // POST /v1/webhooks/notion (no auth required)
  fastify.post(
    '/v1/webhooks/notion',
    {
      schema: {
        operationId: 'receiveNotionWebhook',
        summary: 'Receive Notion webhooks',
        description: 'Receive Notion webhooks (stub - accepts any JSON)',
        tags: ['webhooks'],
        body: {
          type: 'object',
          description: 'Webhook payload (any JSON)',
        },
        response: {
          200: {
            description: 'Webhook received',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: { $ref: 'WebhookResponse#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'data'],
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request, reply) => {
      // Log incoming webhook request for debugging
      request.log.info(
        {
          webhookHeaders: request.headers,
          webhookBody: request.body,
        },
        'Notion webhook received'
      );

      const parseResult = webhookRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return await handleValidationError(parseResult.error, reply);
      }

      // Accept any JSON, no side effects for v1
      return await reply.ok({
        received: true,
      });
    }
  );

  done();
};
