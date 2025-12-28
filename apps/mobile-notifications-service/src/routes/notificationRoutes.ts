/**
 * Notification routes for mobile-notifications-service.
 * GET /mobile-notifications - List notifications.
 * DELETE /mobile-notifications/:notification_id - Delete notification.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '@intexuraos/common';
import { getServices } from '../services.js';
import { listNotifications, deleteNotification } from '../domain/notifications/index.js';
import { listNotificationsResponseSchema } from './schemas.js';

interface ListQuerystring {
  limit?: number;
  cursor?: string;
}

interface DeleteParams {
  notification_id: string;
}

export const notificationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /mobile-notifications
  fastify.get<{ Querystring: ListQuerystring }>(
    '/mobile-notifications',
    {
      schema: {
        operationId: 'listMobileNotifications',
        summary: 'List notifications',
        description: 'Get paginated list of mobile notifications for the authenticated user.',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            cursor: { type: 'string' },
          },
        },
        response: {
          200: {
            description: 'Notifications retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: listNotificationsResponseSchema,
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
    async (request: FastifyRequest<{ Querystring: ListQuerystring }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { limit, cursor } = request.query;

      const listInput: { userId: string; limit?: number; cursor?: string } = {
        userId: user.userId,
      };
      if (limit !== undefined) {
        listInput.limit = limit;
      }
      if (cursor !== undefined) {
        listInput.cursor = cursor;
      }

      const result = await listNotifications(listInput, getServices().notificationRepository);

      if (!result.ok) {
        return await reply.fail(result.error.code, result.error.message);
      }

      return await reply.ok(result.value);
    }
  );

  // DELETE /mobile-notifications/:notification_id
  fastify.delete<{ Params: DeleteParams }>(
    '/mobile-notifications/:notification_id',
    {
      schema: {
        operationId: 'deleteMobileNotification',
        summary: 'Delete notification',
        description: 'Delete a mobile notification by ID. User must own the notification.',
        tags: ['mobile-notifications'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['notification_id'],
          properties: {
            notification_id: { type: 'string' },
          },
        },
        response: {
          204: {
            description: 'Notification deleted successfully',
            type: 'null',
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
          403: {
            description: 'Forbidden - not owner',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
            },
          },
          404: {
            description: 'Not found',
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
    async (request: FastifyRequest<{ Params: DeleteParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { notification_id: id } = request.params;

      const result = await deleteNotification(
        { notificationId: id, userId: user.userId },
        getServices().notificationRepository
      );

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          NOT_FOUND: 404,
          FORBIDDEN: 403,
          INTERNAL_ERROR: 500,
        };
        const status = statusMap[result.error.code] ?? 500;
        reply.status(status);
        return await reply.fail(result.error.code, result.error.message);
      }

      reply.status(204);
      return await reply.send();
    }
  );

  done();
};
