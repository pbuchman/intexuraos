/**
 * Filter routes for mobile-notifications-service.
 * GET /notifications/filters - Get filter options and saved filters.
 * POST /notifications/filters/saved - Create saved filter.
 * DELETE /notifications/filters/saved/:id - Delete saved filter.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { CreateSavedFilterInput } from '../domain/filters/index.js';

interface CreateSavedFilterBody {
  name: string;
  app?: string[];
  device?: string[];
  source?: string[];
  title?: string;
}

interface DeleteSavedFilterParams {
  id: string;
}

const savedFilterSchema = {
  type: 'object',
  required: ['id', 'name', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    app: { type: 'array', items: { type: 'string' } },
    device: { type: 'array', items: { type: 'string' } },
    source: { type: 'array', items: { type: 'string' } },
    title: { type: 'string' },
    createdAt: { type: 'string' },
  },
} as const;

const filtersDataSchema = {
  type: 'object',
  required: ['userId', 'options', 'savedFilters', 'createdAt', 'updatedAt'],
  properties: {
    userId: { type: 'string' },
    options: {
      type: 'object',
      required: ['app', 'device', 'source'],
      properties: {
        app: { type: 'array', items: { type: 'string' } },
        device: { type: 'array', items: { type: 'string' } },
        source: { type: 'array', items: { type: 'string' } },
      },
    },
    savedFilters: {
      type: 'array',
      items: savedFilterSchema,
    },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const filterRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  // GET /notifications/filters
  fastify.get(
    '/notifications/filters',
    {
      schema: {
        operationId: 'getNotificationFilters',
        summary: 'Get filter options and saved filters',
        description:
          'Get available filter options (populated from notifications) and user saved filters.',
        tags: ['notification-filters'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Filters retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: filtersDataSchema,
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

      const result = await getServices().notificationFiltersRepository.getByUserId(user.userId);

      if (!result.ok) {
        return await reply.fail(result.error.code, result.error.message);
      }

      const data = result.value ?? {
        userId: user.userId,
        options: { app: [], device: [], source: [] },
        savedFilters: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return await reply.ok(data);
    }
  );

  // POST /notifications/filters/saved
  fastify.post<{ Body: CreateSavedFilterBody }>(
    '/notifications/filters/saved',
    {
      schema: {
        operationId: 'createSavedNotificationFilter',
        summary: 'Create saved filter',
        description: 'Save a filter configuration for quick access.',
        tags: ['notification-filters'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            app: { type: 'array', items: { type: 'string' } },
            device: { type: 'array', items: { type: 'string' } },
            source: { type: 'array', items: { type: 'string' } },
            title: { type: 'string' },
          },
        },
        response: {
          201: {
            description: 'Saved filter created successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: savedFilterSchema,
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
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
    async (request: FastifyRequest<{ Body: CreateSavedFilterBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { name, app, device, source, title } = request.body;

      const filter: CreateSavedFilterInput = { name };
      if (app !== undefined) filter.app = app;
      if (device !== undefined) filter.device = device;
      if (source !== undefined) filter.source = source;
      if (title !== undefined) filter.title = title;

      const result = await getServices().notificationFiltersRepository.addSavedFilter(
        user.userId,
        filter
      );

      if (!result.ok) {
        return await reply.fail(result.error.code, result.error.message);
      }

      return await reply.status(201).send({
        success: true,
        data: result.value,
        diagnostics: {
          requestId: request.requestId,
          durationMs: Date.now() - request.startTime,
        },
      });
    }
  );

  // DELETE /notifications/filters/saved/:id
  fastify.delete<{ Params: DeleteSavedFilterParams }>(
    '/notifications/filters/saved/:id',
    {
      schema: {
        operationId: 'deleteSavedNotificationFilter',
        summary: 'Delete saved filter',
        description: 'Delete a saved filter by ID.',
        tags: ['notification-filters'],
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          204: {
            description: 'Saved filter deleted successfully',
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
    async (request: FastifyRequest<{ Params: DeleteSavedFilterParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const result = await getServices().notificationFiltersRepository.deleteSavedFilter(
        user.userId,
        request.params.id
      );

      if (!result.ok) {
        const status = result.error.code === 'NOT_FOUND' ? 404 : 500;
        reply.status(status);
        return await reply.fail(result.error.code, result.error.message);
      }

      reply.status(204);
      return await reply.send();
    }
  );

  done();
};
