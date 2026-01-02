/**
 * Filter routes for actions-agent.
 * GET /actions/filters - Get filter options and saved filters.
 * POST /actions/filters/saved - Create saved filter.
 * DELETE /actions/filters/saved/:id - Delete saved filter.
 */
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { getErrorMessage } from '@intexuraos/common-core';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { ActionStatus, ActionType } from '../domain/models/action.js';
import type { CreateSavedActionFilterInput } from '../domain/models/actionFilters.js';

interface CreateSavedFilterBody {
  name: string;
  status?: ActionStatus;
  type?: ActionType;
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
    status: {
      type: 'string',
      enum: [
        'pending',
        'awaiting_approval',
        'processing',
        'completed',
        'failed',
        'rejected',
        'archived',
      ],
    },
    type: {
      type: 'string',
      enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
    },
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
      required: ['status', 'type'],
      properties: {
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'pending',
              'awaiting_approval',
              'processing',
              'completed',
              'failed',
              'rejected',
              'archived',
            ],
          },
        },
        type: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
          },
        },
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
  // GET /actions/filters
  fastify.get(
    '/actions/filters',
    {
      schema: {
        operationId: 'getActionFilters',
        summary: 'Get filter options and saved filters',
        description:
          'Get available filter options (populated from actions) and user saved filters.',
        tags: ['action-filters'],
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            description: 'Filters retrieved successfully',
            type: 'object',
            required: ['success', 'data'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: filtersDataSchema,
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
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

      const { actionFiltersRepository } = getServices();
      const data = await actionFiltersRepository.getByUserId(user.userId);

      const response = data ?? {
        userId: user.userId,
        options: { status: [], type: [] },
        savedFilters: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return await reply.ok(response);
    }
  );

  // POST /actions/filters/saved
  fastify.post<{ Body: CreateSavedFilterBody }>(
    '/actions/filters/saved',
    {
      schema: {
        operationId: 'createSavedActionFilter',
        summary: 'Create saved filter',
        description: 'Save a filter configuration for quick access.',
        tags: ['action-filters'],
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            status: {
              type: 'string',
              enum: [
                'pending',
                'awaiting_approval',
                'processing',
                'completed',
                'failed',
                'rejected',
                'archived',
              ],
            },
            type: {
              type: 'string',
              enum: ['todo', 'research', 'note', 'link', 'calendar', 'reminder'],
            },
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
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          400: {
            description: 'Invalid request',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          401: {
            description: 'Unauthorized',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
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

      const { name, status, type } = request.body;

      const filter: CreateSavedActionFilterInput = { name };
      if (status !== undefined) filter.status = status;
      if (type !== undefined) filter.type = type;

      const { actionFiltersRepository } = getServices();
      const savedFilter = await actionFiltersRepository.addSavedFilter(user.userId, filter);

      return await reply.status(201).send({
        success: true,
        data: savedFilter,
        diagnostics: {
          requestId: request.requestId,
          durationMs: Date.now() - request.startTime,
        },
      });
    }
  );

  // DELETE /actions/filters/saved/:id
  fastify.delete<{ Params: DeleteSavedFilterParams }>(
    '/actions/filters/saved/:id',
    {
      schema: {
        operationId: 'deleteSavedActionFilter',
        summary: 'Delete saved filter',
        description: 'Delete a saved filter by ID.',
        tags: ['action-filters'],
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
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          404: {
            description: 'Not found',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
            },
          },
          500: {
            description: 'Internal error',
            type: 'object',
            required: ['success', 'error'],
            properties: {
              success: { type: 'boolean', enum: [false] },
              error: { $ref: 'ErrorBody#' },
              diagnostics: { $ref: 'Diagnostics#' },
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

      try {
        const { actionFiltersRepository } = getServices();
        await actionFiltersRepository.deleteSavedFilter(user.userId, request.params.id);
        reply.status(204);
        return await reply.send();
      } catch (error) {
        const message = getErrorMessage(error, 'Unknown error');
        if (message.includes('not found')) {
          reply.status(404);
          return await reply.fail('NOT_FOUND', message);
        }
        reply.status(500);
        return await reply.fail('INTERNAL_ERROR', message);
      }
    }
  );

  done();
};
