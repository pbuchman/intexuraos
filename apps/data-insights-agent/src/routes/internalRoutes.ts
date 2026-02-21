/**
 * Internal routes for data-insights-agent.
 * Endpoints called by other services.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { computeVisualization } from '../domain/visualization/index.js';
import { formatVisualization } from './visualizationRoutes.js';
import { getVisualizationResponseSchema } from './visualizationSchemas.js';

interface ComputeVisualizationBody {
  visualizationId: string;
}

export const internalRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Body: ComputeVisualizationBody }>(
    '/internal/visualizations/compute',
    {
      schema: {
        operationId: 'computeVisualization',
        summary: 'Compute visualization data',
        description: 'Internal endpoint for computing visualization data.',
        tags: ['internal'],
        body: {
          type: 'object',
          required: ['visualizationId'],
          properties: {
            visualizationId: { type: 'string' },
          },
        },
        response: {
          200: getVisualizationResponseSchema,
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: ComputeVisualizationBody }>,
      reply: FastifyReply
    ) => {
      logIncomingRequest(request, {
        message: 'Received request to POST /internal/visualizations/compute',
        bodyPreviewLength: 200,
      });

      const authResult = validateInternalAuth(request);
      if (!authResult.valid) {
        return await reply.fail('UNAUTHORIZED', 'Internal auth failed');
      }

      const services = getServices();
      const vizResult = await services.visualizationRepository.getByIdInternal(
        request.body.visualizationId
      );

      if (!vizResult.ok || vizResult.value === null) {
        void reply.status(404);
        return await reply.fail('NOT_FOUND', 'Visualization not found');
      }

      const viz = vizResult.value;
      const result = await computeVisualization(viz.id, viz.userId, {
        visualizationRepository: services.visualizationRepository,
        snapshotRepository: services.snapshotRepository,
        dataTransformService: services.dataTransformService,
      });

      if (!result.ok) {
        return await reply.fail('INTERNAL_ERROR', result.error.message);
      }

      return await reply.ok(formatVisualization(result.value));
    }
  );

  done();
};
