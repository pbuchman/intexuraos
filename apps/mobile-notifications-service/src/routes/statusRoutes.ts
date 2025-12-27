/**
 * Status routes for mobile-notifications-service.
 * GET /mobile-notifications/status - Check if user has configured signature.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../services.js';

export interface StatusResponse {
  configured: boolean;
  lastNotificationAt: string | null;
}

export const statusRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get(
    '/mobile-notifications/status',
    {
      schema: {
        operationId: 'getMobileNotificationsStatus',
        summary: 'Get connection status',
        description: 'Check if user has configured a signature for mobile notifications.',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Status retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['configured', 'lastNotificationAt'],
                properties: {
                  configured: { type: 'boolean' },
                  lastNotificationAt: { type: ['string', 'null'] },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
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
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();

      // Check if user has any signature connections
      const existsResult = await services.signatureConnectionRepository.existsByUserId(user.userId);
      if (!existsResult.ok) {
        return await reply.fail(existsResult.error.code, existsResult.error.message);
      }

      // Get last notification if exists
      let lastNotificationAt: string | null = null;
      if (existsResult.value) {
        const notificationsResult = await services.notificationRepository.findByUserIdPaginated(
          user.userId,
          { limit: 1 }
        );
        if (notificationsResult.ok && notificationsResult.value.notifications.length > 0) {
          const firstNotification = notificationsResult.value.notifications[0];
          if (firstNotification !== undefined) {
            lastNotificationAt = firstNotification.receivedAt;
          }
        }
      }

      const response: StatusResponse = {
        configured: existsResult.value,
        lastNotificationAt,
      };

      return await reply.ok(response);
    }
  );

  done();
};
