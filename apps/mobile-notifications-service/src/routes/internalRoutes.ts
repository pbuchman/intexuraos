/**
 * Internal routes for mobile-notifications-service.
 * These endpoints are for service-to-service communication only.
 */
import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { listNotifications } from '../domain/notifications/index.js';

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
          'Internal endpoint for querying notifications. Used by data-insights-service for composite feeds.',
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
              maximum: 100,
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
              error: { type: 'string' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
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
        reply.status(401);
        return { error: 'Unauthorized' };
      }

      const { userId, filter, limit = 50 } = request.body;

      const input: {
        userId: string;
        limit: number;
        app?: string[];
        source?: string[];
        title?: string;
      } = { userId, limit };

      if (filter?.app !== undefined && filter.app.length > 0) {
        input.app = filter.app;
      }
      if (filter?.source !== undefined && filter.source.length > 0) {
        input.source = [filter.source];
      }
      if (filter?.title !== undefined && filter.title.length > 0) {
        input.title = filter.title;
      }

      const result = await listNotifications(input, getServices().notificationRepository);

      if (!result.ok) {
        reply.status(500);
        return { error: result.error.message };
      }

      const notifications = result.value.notifications.map((n) => ({
        id: n.id,
        app: n.app,
        title: n.title,
        body: n.text,
        timestamp: n.receivedAt,
        source: n.source,
      }));

      return {
        success: true,
        data: {
          notifications,
        },
      };
    }
  );

  done();
};
