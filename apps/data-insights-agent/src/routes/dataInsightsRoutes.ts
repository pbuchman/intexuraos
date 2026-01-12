/**
 * Data insights routes for composite feeds.
 * Endpoints for analyzing data, generating chart definitions, and previewing visualizations.
 */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '@intexuraos/common-http';
import { getServices } from '../services.js';
import { analyzeData, generateChartDefinition, transformDataForPreview } from '../domain/dataInsights/index.js';
import type { TransformDataForPreviewInput } from '../domain/dataInsights/index.js';
import {
  analyzeFeedParamsSchema,
  analyzeFeedResponseSchema,
  chartDefinitionParamsSchema,
  chartDefinitionResponseSchema,
  previewParamsSchema,
  previewBodySchema,
  previewResponseSchema,
} from './dataInsightsSchemas.js';

interface AnalyzeFeedParams {
  feedId: string;
}

interface ChartDefinitionParams {
  feedId: string;
  insightId: string;
}

interface PreviewParams {
  feedId: string;
}

interface PreviewBody {
  chartConfig: object;
  transformInstructions: string;
  insightId: string;
}

export const dataInsightsRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.post<{ Params: AnalyzeFeedParams }>(
    '/composite-feeds/:feedId/analyze',
    {
      schema: {
        operationId: 'analyzeCompositeFeed',
        summary: 'Analyze composite feed data',
        description:
          'Analyze snapshot data and generate up to 5 measurable, trackable data insights with suggested chart types.',
        tags: ['data-insights'],
        security: [{ bearerAuth: [] }],
        params: analyzeFeedParamsSchema,
        response: {
          200: analyzeFeedResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: AnalyzeFeedParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await analyzeData(request.params.feedId, user.userId, {
        compositeFeedRepository: services.compositeFeedRepository,
        snapshotRepository: services.snapshotRepository,
        dataAnalysisService: services.dataAnalysisService,
      });

      if (!result.ok) {
        const error = result.error;
        switch (error.code) {
          case 'FEED_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'SNAPSHOT_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'REPOSITORY_ERROR':
          case 'ANALYSIS_ERROR':
          case 'NO_INSIGHTS': {
            return await reply.fail('INTERNAL_ERROR', error.message);
          }
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return {
        success: true,
        data: {
          insights: result.value.insights,
          noInsightsReason: result.value.noInsightsReason,
        },
      };
    }
  );

  fastify.post<{ Params: ChartDefinitionParams }>(
    '/composite-feeds/:feedId/insights/:insightId/chart-definition',
    {
      schema: {
        operationId: 'generateChartDefinition',
        summary: 'Generate chart definition',
        description:
          'Generate ephemeral chart configuration (Vega-Lite spec without data) and transformation instructions for a specific insight. Not persisted.',
        tags: ['data-insights'],
        security: [{ bearerAuth: [] }],
        params: chartDefinitionParamsSchema,
        response: {
          200: chartDefinitionResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: ChartDefinitionParams }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await generateChartDefinition(
        request.params.feedId,
        request.params.insightId,
        user.userId,
        {
          compositeFeedRepository: services.compositeFeedRepository,
          snapshotRepository: services.snapshotRepository,
          chartDefinitionService: services.chartDefinitionService,
        }
      );

      if (!result.ok) {
        const error = result.error;
        switch (error.code) {
          case 'FEED_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'SNAPSHOT_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'INSIGHT_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'INVALID_CHART_TYPE': {
            void reply.status(400);
            return await reply.fail('INVALID_REQUEST', error.message);
          }
          case 'REPOSITORY_ERROR':
          case 'GENERATION_ERROR': {
            return await reply.fail('INTERNAL_ERROR', error.message);
          }
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return {
        success: true,
        data: {
          vegaLiteConfig: result.value.vegaLiteConfig,
          dataTransformInstructions: result.value.dataTransformInstructions,
        },
      };
    }
  );

  fastify.post<{ Params: PreviewParams; Body: PreviewBody }>(
    '/composite-feeds/:feedId/preview',
    {
      schema: {
        operationId: 'previewChart',
        summary: 'Generate chart preview data',
        description:
          'Transform snapshot data according to chart configuration and transformation instructions for preview rendering.',
        tags: ['data-insights'],
        security: [{ bearerAuth: [] }],
        params: previewParamsSchema,
        body: previewBodySchema,
        response: {
          200: previewResponseSchema,
        },
      },
    },
    async (request: FastifyRequest<{ Params: PreviewParams; Body: PreviewBody }>, reply: FastifyReply) => {
      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const input: TransformDataForPreviewInput = {
        chartConfig: request.body.chartConfig,
        transformInstructions: request.body.transformInstructions,
        insightId: request.body.insightId,
      };

      const result = await transformDataForPreview(request.params.feedId, user.userId, input, {
        compositeFeedRepository: services.compositeFeedRepository,
        snapshotRepository: services.snapshotRepository,
        dataTransformService: services.dataTransformService,
      });

      if (!result.ok) {
        const error = result.error;
        switch (error.code) {
          case 'FEED_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'SNAPSHOT_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'INSIGHT_NOT_FOUND': {
            void reply.status(404);
            return await reply.fail('NOT_FOUND', error.message);
          }
          case 'REPOSITORY_ERROR':
          case 'TRANSFORMATION_ERROR': {
            return await reply.fail('INTERNAL_ERROR', error.message);
          }
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      return {
        success: true,
        data: {
          chartData: result.value,
        },
      };
    }
  );

  done();
};
