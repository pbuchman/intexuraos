/**
 * Fastify schemas for visualization endpoints.
 */

export const visualizationParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string' },
  },
} as const;

export const createVisualizationBodySchema = {
  type: 'object',
  required: ['feedId', 'insightId', 'chartConfig', 'transformInstructions'],
  properties: {
    feedId: { type: 'string' },
    insightId: { type: 'string' },
    chartConfig: {
      type: 'object',
      additionalProperties: true,
      description: 'Vega-Lite chart configuration (no data)',
    },
    transformInstructions: {
      type: 'string',
      description: 'LLM-readable instructions for transforming snapshot data',
    },
  },
} as const;

const visualizationResponseSchema = {
  type: 'object',
  required: [
    'id', 'userId', 'feedId', 'feedName', 'insightId', 'insightTitle',
    'trackableMetric', 'chartConfig', 'transformInstructions',
    'chartData', 'status', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    feedId: { type: 'string' },
    feedName: { type: 'string' },
    insightId: { type: 'string' },
    insightTitle: { type: 'string' },
    trackableMetric: { type: 'string' },
    chartConfig: { type: 'object', additionalProperties: true },
    transformInstructions: { type: 'string' },
    chartData: {
      type: ['array', 'null'],
      items: { type: 'object', additionalProperties: true },
    },
    status: { type: 'string', enum: ['pending', 'ready', 'refreshing', 'error'] },
    lastError: { type: 'string' },
    lastRefreshedAt: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

export const createVisualizationResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: visualizationResponseSchema,
  },
} as const;

export const getVisualizationResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: visualizationResponseSchema,
  },
} as const;

export const listVisualizationsResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: {
      type: 'array',
      items: visualizationResponseSchema,
    },
  },
} as const;

export const deleteVisualizationResponseSchema = {
  type: 'object',
  required: ['success', 'data'],
  properties: {
    success: { type: 'boolean' },
    data: { type: 'object' },
  },
} as const;
