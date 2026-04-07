/**
 * Status routes for mobile-notifications-service.
 * GET /mobile-notifications/status - Check if user has configured signature.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';

export interface StatusResponse {
  configured: boolean;
  lastNotificationAt: string | null;
/* v8 ignore start -- test-infra: cannot test route registration without mocking all services @preserve */
}

export const statusRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
/* v8 ignore stop @preserve */
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
        if (!notificationsResult.ok) {
          return await reply.fail(
            notificationsResult.error.code,
            notificationsResult.error.message
          );
        }
        if (notificationsResult.value.notifications.length > 0) {
          const firstNotification = notificationsResult.value.notifications[0];
          /* v8 ignore start -- ts-type: length > 0 check guarantees notifications[0] exists @preserve */
          if (firstNotification !== undefined) {
            lastNotificationAt = firstNotification.receivedAt;
          }
          /* v8 ignore stop @preserve */
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

