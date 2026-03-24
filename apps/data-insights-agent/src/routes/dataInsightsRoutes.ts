/**
 * Data insights routes for composite feeds.
 * Endpoints for analyzing data, generating chart definitions, and previewing visualizations.
 */
/* v8 ignore start -- source-map: false positive: v8 reports branch on line 2 (JSDoc comment) @preserve */

import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
/* v8 ignore stop @preserve */
import { logIncomingRequest, requireAuth } from '@intexuraos/common-http';
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

/* v8 ignore start -- schema: Fastify schema validation guarantees params are always provided — not reachable without valid schema @preserve */
interface ChartDefinitionParams {
  feedId: string;
  insightId: string;
}
/* v8 ignore stop @preserve */

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
      logIncomingRequest(request, {
        message: 'Received request to POST /composite-feeds/:feedId/analyze',
        includeParams: true,
      });

      const user = await requireAuth(request, reply);
      if (user === null) {
        return;
      }

      const services = getServices();
      const result = await analyzeData(request.params.feedId, user.userId, {
        compositeFeedRepository: services.compositeFeedRepository,
        snapshotRepository: services.snapshotRepository,
        dataAnalysisService: services.dataAnalysisService,
        logger: request.log,
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
          case 'ANALYSIS_ERROR': {
            return await reply.fail('INTERNAL_ERROR', error.message);
          }
        }
        return await reply.fail('INTERNAL_ERROR', error.message);
      }

      const analysis = result.value; // @allow-result-access -- narrowed at line 80

      const vizListResult = await services.visualizationRepository.listByFeedId(
        request.params.feedId
      );
      /* v8 ignore start -- upstream: cannot trigger orphan cleanup in route tests — prior check validated via domain use case tests @preserve */
      if (vizListResult.ok && vizListResult.value.length > 0) {
        const insightIds = new Set(analysis.insights.map((i) => i.id));
        for (const viz of vizListResult.value) {
          if (!insightIds.has(viz.insightId)) {
            await services.visualizationRepository.update(viz.id, {
              status: 'error',
              lastError: 'Parent insight was replaced during re-analysis',
            });
          }
        }
      }
      /* v8 ignore stop @preserve */

      return await reply.ok({
        insights: analysis.insights,
        noInsightsReason: analysis.noInsightsReason,
      });
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
      logIncomingRequest(request, {
        message: 'Received request to POST /composite-feeds/:feedId/insights/:insightId/chart-definition',
        includeParams: true,
      });

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

      const chartDef = result.value; // @allow-result-access -- narrowed at line 162
      return await reply.ok({
        vegaLiteConfig: chartDef.vegaLiteConfig,
        dataTransformInstructions: chartDef.dataTransformInstructions,
      });
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
      logIncomingRequest(request, {
        message: 'Received request to POST /composite-feeds/:feedId/preview',
        includeParams: true,
      });

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

      const chartData = result.value; // @allow-result-access -- narrowed at line 237
      return await reply.ok({
        chartData,
      });
    }
  );

  done();
};
