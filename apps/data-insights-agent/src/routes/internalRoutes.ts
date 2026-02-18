/**
 * Internal routes for data-insights-agent.
 * Endpoints called by Cloud Scheduler and other services.
 */

import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { validateInternalAuth, logIncomingRequest } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { refreshAllSnapshots } from '../domain/snapshot/index.js';
import { computeVisualization } from '../domain/visualization/index.js';
import { formatVisualization } from './visualizationRoutes.js';
import { getVisualizationResponseSchema } from './visualizationSchemas.js';

interface ComputeVisualizationBody {
  visualizationId: string;
}

interface PubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
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

  fastify.post(
    '/internal/snapshots/refresh',
    {
      schema: {
        operationId: 'refreshAllSnapshots',
        summary: 'Refresh all composite feed snapshots',
        description:
          'Internal endpoint for Cloud Scheduler to refresh all composite feed snapshots. Triggered every 15 minutes via Pub/Sub push.',
        tags: ['internal'],
        body: {
          type: 'object',
          properties: {
            message: {
              type: 'object',
              properties: {
                data: { type: 'string', description: 'Base64 encoded message data' },
                messageId: { type: 'string' },
                publishTime: { type: 'string' },
              },
              required: ['data', 'messageId'],
            },
            subscription: { type: 'string' },
          },
          required: ['message'],
        },
        response: {
          200: {
            description: 'Refresh completed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  refreshed: { type: 'number' },
                  failed: { type: 'number' },
                  errors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        feedId: { type: 'string' },
                        error: { type: 'string' },
                      },
                    },
                  },
                  durationMs: { type: 'number' },
                  visualizationsRefreshed: { type: 'number' },
                  visualizationsFailed: { type: 'number' },
                },
                required: ['refreshed', 'failed', 'errors', 'durationMs'],
              },
            },
            required: ['success', 'data'],
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
            description: 'Refresh failed',
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      logIncomingRequest(request, {
        message: 'Received request to /internal/snapshots/refresh',
        bodyPreviewLength: 200,
      });

      const fromHeader = request.headers.from;
      const isPubSubPush = typeof fromHeader === 'string' && fromHeader === 'noreply@google.com';

      if (isPubSubPush) {
        request.log.info(
          {
            from: fromHeader,
            userAgent: request.headers['user-agent'],
          },
          'Authenticated Pub/Sub push request (OIDC validated by Cloud Run)'
        );
      } else {
        const authResult = validateInternalAuth(request);
        if (!authResult.valid) {
          request.log.warn(
            { reason: authResult.reason },
            'Internal auth failed for /internal/snapshots/refresh'
          );
          return await reply.fail('UNAUTHORIZED', 'Internal auth failed for /internal/snapshots/refresh');
        }
      }

      const body = request.body as PubSubMessage;

      try {
        const decoded = Buffer.from(body.message.data, 'base64').toString('utf-8');
        request.log.info(
          {
            messageId: body.message.messageId,
            trigger: JSON.parse(decoded),
          },
          'Decoded Pub/Sub message'
        );
      } catch {
        request.log.warn({ data: body.message.data }, 'Failed to decode Pub/Sub message data');
      }

      const startTime = Date.now();

      request.log.info('Starting snapshot refresh for all feeds');

      const services = getServices();
      const result = await refreshAllSnapshots({
        snapshotRepository: services.snapshotRepository,
        compositeFeedRepository: services.compositeFeedRepository,
        dataSourceRepository: services.dataSourceRepository,
        mobileNotificationsClient: services.mobileNotificationsClient,
        visualizationRepository: services.visualizationRepository,
        dataTransformService: services.dataTransformService,
        logger: request.log,
      });

      const durationMs = Date.now() - startTime;

      if (!result.ok) {
        request.log.error(
          {
            error: result.error,
            durationMs,
          },
          'Snapshot refresh failed'
        );
        return await reply.fail('INTERNAL_ERROR', result.error);
      }

      const { refreshed, failed, errors, visualizationsRefreshed, visualizationsFailed } = result.value;

      if (errors.length > 0) {
        request.log.warn(
          {
            refreshed,
            failed,
            errors: errors.slice(0, 10),
            durationMs,
          },
          'Snapshot refresh completed with errors'
        );
      } else {
        request.log.info(
          {
            refreshed,
            failed,
            durationMs,
          },
          'Snapshot refresh completed successfully'
        );
      }

      return await reply.ok({
        refreshed,
        failed,
        errors,
        durationMs,
        visualizationsRefreshed,
        visualizationsFailed,
      });
    }
  );

  done();
};
