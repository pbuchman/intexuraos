/**
 * Fastify schemas for data insights endpoints.
 */

import { dataInsightSchema } from './compositeFeedSchemas.js';

/**
 * POST /composite-feeds/:feedId/analyze
 */
export const analyzeFeedParamsSchema = {
  type: 'object',
  required: ['feedId'],
  properties: {
    feedId: { type: 'string' },
  },
} as const;

export const analyzeFeedResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      required: ['insights'],
      properties: {
        insights: {
          type: 'array',
          items: dataInsightSchema,
          maxItems: 5,
        },
        noInsightsReason: {
          type: 'string',
          description: 'Reason why insights could not be generated (when insights array is empty)',
        },
      },
    },
  },
} as const;

/**
 * POST /composite-feeds/:feedId/insights/:insightId/chart-definition
 */
export const chartDefinitionParamsSchema = {
  type: 'object',
  required: ['feedId', 'insightId'],
  properties: {
    feedId: { type: 'string' },
    insightId: { type: 'string' },
  },
} as const;

export const chartDefinitionResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      required: ['vegaLiteConfig', 'dataTransformInstructions'],
      properties: {
        vegaLiteConfig: {
          type: 'object',
          description: 'Vega-Lite chart configuration without data',
        },
        dataTransformInstructions: {
          type: 'string',
          description: 'LLM-readable instructions for transforming snapshot data',
        },
      },
    },
  },
} as const;

/**
 * POST /composite-feeds/:feedId/preview
 */
export const previewParamsSchema = {
  type: 'object',
  required: ['feedId'],
  properties: {
    feedId: { type: 'string' },
  },
} as const;

export const previewBodySchema = {
  type: 'object',
  required: ['chartConfig', 'transformInstructions', 'insightId'],
  properties: {
    chartConfig: {
      type: 'object',
      description: 'Vega-Lite chart configuration from chart definition endpoint',
    },
    transformInstructions: {
      type: 'string',
      description: 'Transform instructions from chart definition endpoint',
    },
    insightId: {
      type: 'string',
      description: 'ID of the insight being previewed',
    },
  },
} as const;

export const previewResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'object',
      required: ['chartData'],
      properties: {
        chartData: {
          type: 'array',
          description: 'Transformed data ready for Vega-Lite rendering',
          items: { type: 'object' },
        },
      },
    },
  },
} as const;
