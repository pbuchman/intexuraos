/**
 * Public and internal routes for visualization endpoints.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import {
  createVisualization,
  computeVisualization,
  listVisualizations,
  getVisualization,
  deleteVisualization,
} from '../domain/visualization/index.js';
import type { Visualization } from '../domain/visualization/index.js';
import {
  visualizationParamsSchema,
  createVisualizationBodySchema,
  createVisualizationResponseSchema,
  getVisualizationResponseSchema,
  listVisualizationsResponseSchema,
  deleteVisualizationResponseSchema,
} from './visualizationSchemas.js';

interface VisualizationParams {
  id: string;
}

interface CreateVisualizationBody {
  feedId: string;
  insightId: string;
  chartConfig: object;
  transformInstructions: string;
}

export function formatVisualization(viz: Visualization): object {
  return {
    id: viz.id,
    userId: viz.userId,
    feedId: viz.feedId,
    feedName: viz.feedName,
    insightId: viz.insightId,
    insightTitle: viz.insightTitle,
    trackableMetric: viz.trackableMetric,
    chartConfig: viz.chartConfig,
    transformInstructions: viz.transformInstructions,
    chartData: viz.chartData,
    status: viz.status,
    ...(viz.lastError !== undefined && { lastError: viz.lastError }),
    ...(viz.lastRefreshedAt !== undefined && {
      lastRefreshedAt: viz.lastRefreshedAt.toISOString(),
    }),
    createdAt: viz.createdAt.toISOString(),
    updatedAt: viz.updatedAt.toISOString(),
  };
}

export const visualizationRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: CreateVisualizationBody }>(
    '/visualizations',
    {
      schema: {
        operationId: 'createVisualization',
        summary: 'Create visualization',
        description:
          'Create a new visualization from a chart configuration. Computation runs async.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        body: createVisualizationBodySchema,
        response: {
          201: createVisualizationResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateVisualizationBody }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /visualizations',
        bodyPreviewLength: 200,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await createVisualization(user.userId, {
        feedId: request.body.feedId,
        insightId: request.body.insightId,
        chartConfig: request.body.chartConfig,
        transformInstructions: request.body.transformInstructions,
      }, {
        compositeFeedRepository: services.compositeFeedRepository,
        visualizationRepository: services.visualizationRepository,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'FEED_NOT_FOUND' || error.code === 'INSIGHT_NOT_FOUND') {
          void reply.status(404);
          return await reply.fail('NOT_FOUND', error.message);
        }
        if (error.code === 'LIMIT_EXCEEDED') {
          void reply.status(400);
          return await reply.fail('INVALID_REQUEST', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      const viz = result.value;

      computeVisualization(viz.id, viz.userId, {
        visualizationRepository: services.visualizationRepository,
        snapshotRepository: services.snapshotRepository,
        dataTransformService: services.dataTransformService,
      }).catch((error: unknown) => {
        request.log.warn(
          { error, visualizationId: viz.id },
          'Fire-and-forget compute failed'
        );
      });

      void reply.status(201);
      return await reply.ok(formatVisualization(viz));
    }
  );

  fastify.get(
    '/visualizations',
    {
      schema: {
        operationId: 'listVisualizations',
        summary: 'List visualizations',
        description: 'List all visualizations for the authenticated user.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        response: {
          200: listVisualizationsResponseSchema,
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, { message: 'Received request to GET /visualizations' });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await listVisualizations(user.userId, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok(result.value.map(formatVisualization));
    }
  );

  fastify.get<{ Params: VisualizationParams }>(
    '/visualizations/:id',
    {
      schema: {
        operationId: 'getVisualization',
        summary: 'Get visualization',
        description: 'Get a specific visualization by ID (for polling status).',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          200: getVisualizationResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to GET /visualizations/:id',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await getVisualization(request.params.id, user.userId, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!result.ok) {
        const error = result.error;
        if (error.code === 'NOT_FOUND') {
          void reply.status(404);
          return await reply.fail('NOT_FOUND', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return await reply.ok(formatVisualization(result.value));
    }
  );

  fastify.delete<{ Params: VisualizationParams }>(
    '/visualizations/:id',
    {
      schema: {
        operationId: 'deleteVisualization',
        summary: 'Delete visualization',
        description: 'Delete a visualization.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          200: deleteVisualizationResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to DELETE /visualizations/:id',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await deleteVisualization(request.params.id, user.userId, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      return await reply.ok({});
    }
  );

  fastify.post<{ Params: VisualizationParams }>(
    '/visualizations/:id/refresh',
    {
      schema: {
        operationId: 'refreshVisualization',
        summary: 'Refresh visualization',
        description: 'Manually trigger re-computation of visualization data.',
        tags: ['visualizations'],
        security: [{ bearerAuth: [] }],
        params: visualizationParamsSchema,
        response: {
          200: getVisualizationResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: VisualizationParams }>, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /visualizations/:id/refresh',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const vizResult = await getVisualization(request.params.id, user.userId, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!vizResult.ok) {
        const error = vizResult.error;
        if (error.code === 'NOT_FOUND') {
          void reply.status(404);
          return await reply.fail('NOT_FOUND', error.message);
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      if (vizResult.value.status === 'refreshing') {
        return await reply.ok(formatVisualization(vizResult.value));
      }

      await services.visualizationRepository.update(request.params.id, {
        status: 'refreshing',
      });

      computeVisualization(request.params.id, user.userId, {
        visualizationRepository: services.visualizationRepository,
        snapshotRepository: services.snapshotRepository,
        dataTransformService: services.dataTransformService,
      }).catch((error: unknown) => {
        request.log.warn(
          { error, visualizationId: request.params.id },
          'Manual refresh compute failed'
        );
      });

      const updated = await getVisualization(request.params.id, user.userId, {
        visualizationRepository: services.visualizationRepository,
      });

      if (!updated.ok) {
        return await reply.fail('INTERNAL_ERROR', updated.error.message);
      }

      return await reply.ok(formatVisualization(updated.value));
    }
  );

  done();
};
