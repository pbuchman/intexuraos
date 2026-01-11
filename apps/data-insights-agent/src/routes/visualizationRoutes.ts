/**
 * Public routes for visualization endpoints.
 * CRUD operations and async generation for feed visualizations.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import type { Visualization, CreateVisualizationRequest } from '../domain/visualization/index.js';
import {
  createVisualization,
  generateVisualizationContent,
  reportRenderError,
} from '../domain/visualization/index.js';
import {
  createVisualizationBodySchema,
  updateVisualizationBodySchema,
  feedIdParamsSchema,
  visualizationParamsSchema,
  reportRenderErrorBodySchema,
  visualizationResponseSchema,
} from './visualizationSchemas.js';

interface FeedIdParams {
  feedId: string;
}

interface VisualizationParams {
  feedId: string;
  id: string;
}

interface CreateVisualizationBody {
  title: string;
  description: string;
  type: 'chart' | 'table' | 'summary' | 'custom';
}

interface UpdateVisualizationBody {
  title?: string;
  description?: string;
  type?: 'chart' | 'table' | 'summary' | 'custom';
}

interface ReportRenderErrorBody {
  errorMessage: string;
}

function formatVisualization(viz: Visualization): object {
  return {
    id: viz.id,
    feedId: viz.feedId,
    userId: viz.userId,
    title: viz.title,
    description: viz.description,
    type: viz.type,
    status: viz.status,
    htmlContent: viz.htmlContent,
    errorMessage: viz.errorMessage,
    renderErrorCount: viz.renderErrorCount,
    createdAt: viz.createdAt.toISOString(),
    updatedAt: viz.updatedAt.toISOString(),
    lastGeneratedAt: viz.lastGeneratedAt !== null ? viz.lastGeneratedAt.toISOString() : null,
  };
}

export const visualizationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.get<{ Params: FeedIdParams }>(
    '/composite-feeds/:feedId/visualizations',
    {
      schema: {
        operationId: 'listVisualizations',
        summary: 'List visualizations',
        description: 'List all visualizations for a composite feed.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: feedIdParamsSchema,
        response: {
          200: {
            description: 'List of visualizations',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'array',
                items: visualizationResponseSchema,
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: FeedIdParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { visualizationRepository } = getServices();
      const result = await visualizationRepository.listByFeedId(request.params.feedId, user.userId);

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(result.value.map(formatVisualization));
    }
  );

  fastify.post<{ Params: FeedIdParams; Body: CreateVisualizationBody }>(
    '/composite-feeds/:feedId/visualizations',
    {
      schema: {
        operationId: 'createVisualization',
        summary: 'Create visualization',
        description:
          'Create a new visualization. Returns immediately with pending status. Generation happens asynchronously.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: feedIdParamsSchema,
        body: createVisualizationBodySchema,
        response: {
          201: {
            description: 'Created visualization (pending generation)',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: visualizationResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: FeedIdParams; Body: CreateVisualizationBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const createRequest: CreateVisualizationRequest = {
        title: request.body.title,
        description: request.body.description,
        type: request.body.type,
      };

      const result = await createVisualization(request.params.feedId, user.userId, createRequest, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'VALIDATION_ERROR') {
          void reply.status(400);
          return await reply.fail('INVALID_REQUEST', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      const visualization = result.value;

      generateVisualizationContent(visualization.id, request.params.feedId, user.userId, {
        visualizationRepository: services.visualizationRepository,
        visualizationGenerationService: services.visualizationGenerationService,
        snapshotRepository: services.snapshotRepository,
        logger: request.log,
      }).catch((error: unknown) => {
        request.log.warn(
          { error, visualizationId: visualization.id },
          'Failed to generate visualization content (async)'
        );
      });

      void reply.status(201);
      return {
        success: true,
        data: formatVisualization(visualization),
        diagnostics: {
          requestId: request.requestId,
          durationMs: Date.now() - request.startTime,
        },
      };
    }
  );

  fastify.get<{ Params: VisualizationParams }>(
    '/composite-feeds/:feedId/visualizations/:id',
    {
      schema: {
        operationId: 'getVisualization',
        summary: 'Get visualization',
        description: 'Get a specific visualization by ID.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          200: {
            description: 'Visualization details',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: visualizationResponseSchema,
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { visualizationRepository } = getServices();
      const result = await visualizationRepository.getById(
        request.params.id,
        request.params.feedId,
        user.userId
      );

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      if (result.value === null) {
        return await reply.fail('NOT_FOUND', 'Visualization not found');
      }

      return await reply.ok(formatVisualization(result.value));
    }
  );

  fastify.put<{ Params: VisualizationParams; Body: UpdateVisualizationBody }>(
    '/composite-feeds/:feedId/visualizations/:id',
    {
      schema: {
        operationId: 'updateVisualization',
        summary: 'Update visualization',
        description: 'Update visualization metadata. Does not regenerate content.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        body: updateVisualizationBodySchema,
        response: {
          200: {
            description: 'Updated visualization',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: visualizationResponseSchema,
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: VisualizationParams; Body: UpdateVisualizationBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { visualizationRepository } = getServices();

      const updateData: {
        title?: string;
        description?: string;
        type?: 'chart' | 'table' | 'summary' | 'custom';
      } = {};

      if (request.body.title !== undefined) {
        updateData.title = request.body.title;
      }
      if (request.body.description !== undefined) {
        updateData.description = request.body.description;
      }
      if (request.body.type !== undefined) {
        updateData.type = request.body.type;
      }

      const result = await visualizationRepository.update(
        request.params.id,
        request.params.feedId,
        user.userId,
        updateData
      );

      if (!result.ok) {
        if (result.error.includes('not found')) {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(formatVisualization(result.value));
    }
  );

  fastify.delete<{ Params: VisualizationParams }>(
    '/composite-feeds/:feedId/visualizations/:id',
    {
      schema: {
        operationId: 'deleteVisualization',
        summary: 'Delete visualization',
        description: 'Delete a visualization.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          200: {
            description: 'Deletion confirmed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { visualizationRepository } = getServices();
      const result = await visualizationRepository.delete(
        request.params.id,
        request.params.feedId,
        user.userId
      );

      if (!result.ok) {
        if (result.error.includes('not found')) {
          return await reply.fail('NOT_FOUND', result.error);
        }
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok({});
    }
  );

  fastify.post<{ Params: VisualizationParams }>(
    '/composite-feeds/:feedId/visualizations/:id/regenerate',
    {
      schema: {
        operationId: 'regenerateVisualization',
        summary: 'Regenerate visualization',
        description: 'Force regeneration of visualization content using current snapshot data.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          202: {
            description: 'Regeneration started',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();

      const vizResult = await services.visualizationRepository.getById(
        request.params.id,
        request.params.feedId,
        user.userId
      );

      if (!vizResult.ok) {
        return await reply.fail('INTERNAL_ERROR', vizResult.error);
      }

      if (vizResult.value === null) {
        return await reply.fail('NOT_FOUND', 'Visualization not found');
      }

      generateVisualizationContent(request.params.id, request.params.feedId, user.userId, {
        visualizationRepository: services.visualizationRepository,
        visualizationGenerationService: services.visualizationGenerationService,
        snapshotRepository: services.snapshotRepository,
        logger: request.log,
      }).catch((error: unknown) => {
        request.log.warn(
          { error, visualizationId: request.params.id },
          'Failed to regenerate visualization content (async)'
        );
      });

      void reply.status(202);
      return await reply.ok({ message: 'Regeneration started' });
    }
  );

  fastify.post<{ Params: VisualizationParams; Body: ReportRenderErrorBody }>(
    '/composite-feeds/:feedId/visualizations/:id/report-error',
    {
      schema: {
        operationId: 'reportRenderError',
        summary: 'Report render error',
        description:
          'Report a client-side rendering error. After too many errors, visualization is disabled.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        body: reportRenderErrorBodySchema,
        response: {
          200: {
            description: 'Error reported',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  errorCount: { type: 'number' },
                  disabled: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: VisualizationParams; Body: ReportRenderErrorBody }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const { visualizationRepository } = getServices();
      const result = await reportRenderError(
        request.params.id,
        request.params.feedId,
        user.userId,
        request.body.errorMessage,
        {
          visualizationRepository,
        }
      );

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'NOT_FOUND') {
          return await reply.fail('NOT_FOUND', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return await reply.ok({
        errorCount: result.value.errorCount,
        disabled: result.value.shouldDisable,
      });
    }
  );

  done();
};
