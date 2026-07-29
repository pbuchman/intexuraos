/**
 * Internal routes for ordinary mobile-notification queries.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, validateInternalAuth } from '@intexuraos/common-http';
import { listNotifications } from '../domain/notifications/index.js';
import { getServices } from '../services.js';

interface QueryNotificationsBody {
  userId: string;
  filter?: {
    app?: string[];
    source?: string;
    title?: string;
  };
  limit?: number;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: QueryNotificationsBody }>(
    '/internal/mobile-notifications/query',
    {
      schema: {
        operationId: 'queryNotificationsInternal',
        summary: 'Query notifications (internal)',
        description:
          'Internal endpoint for querying notifications. Used by internal consumers for data aggregation.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['userId'],
          properties: {
            userId: { type: 'string', description: 'User ID to query notifications for' },
            filter: {
              type: 'object',
              properties: {
                app: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by app names (OR logic)',
                },
                source: {
                  type: 'string',
                  description: 'Filter by source (single value)',
                },
                title: {
                  type: 'string',
                  description: 'Filter by title (case-insensitive contains)',
                },
              },
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 1000,
              default: 50,
              description: 'Maximum number of notifications to return',
            },
          },
        },
        response: {
          200: {
            description: 'Notifications retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['notifications'],
                properties: {
                  notifications: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        app: { type: 'string' },
                        title: { type: 'string' },
                        body: { type: 'string' },
                        timestamp: { type: 'string' },
                        source: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
          500: {
            description: 'Internal error',
            type: 'object',
            properties: {
              success: { type: 'boolean', const: false },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
            required: ['success', 'error'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: QueryNotificationsBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/mobile-notifications/query',
        bodyPreviewLength: 200,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        request.log.warn(
          { reason: authResult.reason },
          'Internal auth failed for query notifications'
        );
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed for query notifications');
      }

      const { userId, filter, limit = 50 } = request.body;
      const input: {
        userId: string;
        limit: number;
        app?: string[];
        source?: string[];
        title?: string;
      } = { userId, limit };

      if (filter?.app !== undefined && filter.app.length > 0) input.app = filter.app;
      if (filter?.source !== undefined && filter.source.length > 0) input.source = [filter.source];
      if (filter?.title !== undefined && filter.title.length > 0) input.title = filter.title;

      const result = await listNotifications(input, getServices().notificationRepository);
      if (!result.ok) return await reply.fail('INTERNAL_ERROR', result.error.message);

      return await reply.ok({
        notifications: result.value.notifications.map((notification) => ({
          id: notification.id,
          app: notification.app,
          title: notification.title,
          body: notification.text,
          timestamp: notification.receivedAt,
          source: notification.source,
        })),
      });
    }
  );

  done();
};
