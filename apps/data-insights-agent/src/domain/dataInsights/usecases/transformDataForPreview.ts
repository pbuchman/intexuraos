/**
 * Transform data for preview use case (User Story 3).
 * Transforms snapshot data according to chart definition instructions for preview rendering.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { CompositeFeedRepository } from '../../compositeFeed/index.js';
import type { SnapshotRepository } from '../../snapshot/index.js';
import type { DataTransformService } from '../ports.js';

export interface TransformDataForPreviewDeps {
  compositeFeedRepository: CompositeFeedRepository;
  snapshotRepository: SnapshotRepository;
  dataTransformService: DataTransformService;
}

export interface TransformDataForPreviewError {
  code:
    | 'FEED_NOT_FOUND'
    | 'SNAPSHOT_NOT_FOUND'
    | 'INSIGHT_NOT_FOUND'
    | 'REPOSITORY_ERROR'
    | 'TRANSFORMATION_ERROR';
  message: string;
}

export interface TransformDataForPreviewInput {
  chartConfig: object;
  transformInstructions: string;
  insightId: string;
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
 * Transform snapshot data for chart preview.
 */
export async function transformDataForPreview(
  feedId: string,
  userId: string,
  input: TransformDataForPreviewInput,
  deps: TransformDataForPreviewDeps
): Promise<Result<unknown[], TransformDataForPreviewError>> {
  const { compositeFeedRepository, snapshotRepository, dataTransformService } = deps;

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

  const insight = feed.dataInsights.find((i) => i.id === input.insightId);
  if (insight === undefined) {
    return err({
      code: 'INSIGHT_NOT_FOUND',
      message: `Insight not found: ${input.insightId}`,
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
  const jsonSchema = buildCompositeFeedSchema();

  const transformResult = await dataTransformService.transformData(
    userId,
    jsonSchema,
    snapshot.data,
    input.chartConfig,
    input.transformInstructions,
    {
      title: insight.title,
      trackableMetric: insight.trackableMetric,
    }
  );

  if (!transformResult.ok) {
    return err({
      code: 'TRANSFORMATION_ERROR',
      message: transformResult.error.message,
    });
  }

  return ok(transformResult.value);
}
