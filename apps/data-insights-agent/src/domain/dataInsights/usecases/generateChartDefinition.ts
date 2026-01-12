/**
 * Generate chart definition use case (User Story 2).
 * Generates ephemeral chart configuration for a specific data insight.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { CompositeFeedRepository } from '../../compositeFeed/index.js';
import type { SnapshotRepository } from '../../snapshot/index.js';
import type { ChartDefinitionService } from '../../../infra/gemini/chartDefinitionService.js';
import { CHART_TYPES } from '../chartTypes.js';

export interface GenerateChartDefinitionDeps {
  compositeFeedRepository: CompositeFeedRepository;
  snapshotRepository: SnapshotRepository;
  chartDefinitionService: ChartDefinitionService;
}

export interface GenerateChartDefinitionError {
  code:
    | 'FEED_NOT_FOUND'
    | 'SNAPSHOT_NOT_FOUND'
    | 'INSIGHT_NOT_FOUND'
    | 'INVALID_CHART_TYPE'
    | 'REPOSITORY_ERROR'
    | 'GENERATION_ERROR';
  message: string;
}

export interface ChartDefinitionResult {
  vegaLiteConfig: object;
  dataTransformInstructions: string;
}

/**
 * Build JSON schema representation of composite feed data.
 */
function buildCompositeFeedSchema(): object {
  return {
    type: 'object',
    properties: {
      feedId: { type: 'string' },
      feedName: { type: 'string' },
      purpose: { type: 'string' },
      generatedAt: { type: 'string', format: 'date-time' },
      staticSources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
      notifications: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            filterId: { type: 'string' },
            filterName: { type: 'string' },
            criteria: {
              type: 'object',
              properties: {
                app: { type: 'array', items: { type: 'string' } },
                source: { type: 'string' },
                title: { type: 'string' },
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  app: { type: 'string' },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  timestamp: { type: 'string' },
                  source: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Generate chart definition for a specific insight (ephemeral, not persisted).
 */
export async function generateChartDefinition(
  feedId: string,
  insightId: string,
  userId: string,
  deps: GenerateChartDefinitionDeps
): Promise<Result<ChartDefinitionResult, GenerateChartDefinitionError>> {
  const { compositeFeedRepository, snapshotRepository, chartDefinitionService } = deps;

  const feedResult = await compositeFeedRepository.getById(feedId, userId);
  if (!feedResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    return err({
      code: 'FEED_NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const feed = feedResult.value;

  if (feed.dataInsights === null || feed.dataInsights.length === 0) {
    return err({
      code: 'INSIGHT_NOT_FOUND',
      message: 'No insights available. Please analyze the feed first.',
    });
  }

  const insight = feed.dataInsights.find((i) => i.id === insightId);
  if (insight === undefined) {
    return err({
      code: 'INSIGHT_NOT_FOUND',
      message: `Insight not found: ${insightId}`,
    });
  }

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);
  if (!snapshotResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  if (snapshotResult.value === null) {
    return err({
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'No snapshot available. Please refresh the feed first.',
    });
  }

  const snapshot = snapshotResult.value;

  const chartType = CHART_TYPES.find((ct) => ct.id === insight.suggestedChartType);
  if (chartType === undefined) {
    return err({
      code: 'INVALID_CHART_TYPE',
      message: `Invalid chart type: ${insight.suggestedChartType}`,
    });
  }

  const jsonSchema = buildCompositeFeedSchema();

  const chartDefResult = await chartDefinitionService.generateChartDefinition(
    userId,
    jsonSchema,
    snapshot.data,
    chartType.vegaLiteSchema,
    {
      title: insight.title,
      description: insight.description,
      trackableMetric: insight.trackableMetric,
      suggestedChartType: insight.suggestedChartType,
    }
  );

  if (!chartDefResult.ok) {
    return err({
      code: 'GENERATION_ERROR',
      message: chartDefResult.error.message,
    });
  }

  return ok({
    vegaLiteConfig: chartDefResult.value.vegaLiteConfig,
    dataTransformInstructions: chartDefResult.value.transformInstructions,
  });
}
