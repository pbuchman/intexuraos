/**
 * Create visualization use case.
 * Creates a new visualization in pending state, ready for async computation.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { CompositeFeedRepository } from '../../compositeFeed/index.js';
import type { VisualizationRepository } from '../ports/index.js';
import type { Visualization } from '../models/index.js';
import { MAX_VISUALIZATIONS_PER_FEED } from '../models/index.js';

export interface CreateVisualizationDeps {
  compositeFeedRepository: CompositeFeedRepository;
  visualizationRepository: VisualizationRepository;
}

export interface CreateVisualizationInput {
  feedId: string;
  insightId: string;
  chartConfig: object;
  transformInstructions: string;
}

export interface CreateVisualizationError {
  code: 'FEED_NOT_FOUND' | 'INSIGHT_NOT_FOUND' | 'LIMIT_EXCEEDED' | 'REPOSITORY_ERROR';
  message: string;
}

export async function createVisualization(
  userId: string,
  input: CreateVisualizationInput,
  deps: CreateVisualizationDeps
): Promise<Result<Visualization, CreateVisualizationError>> {
  const { compositeFeedRepository, visualizationRepository } = deps;

  const feedResult = await compositeFeedRepository.getById(input.feedId, userId);
  if (!feedResult.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: feedResult.error });
  }

  if (feedResult.value === null) {
    return err({ code: 'FEED_NOT_FOUND', message: 'Composite feed not found' });
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

  const existingResult = await visualizationRepository.listByFeedId(input.feedId);
  if (!existingResult.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: existingResult.error });
  }

  if (existingResult.value.length >= MAX_VISUALIZATIONS_PER_FEED) {
    return err({
      code: 'LIMIT_EXCEEDED',
      message: `Maximum of ${String(MAX_VISUALIZATIONS_PER_FEED)} visualizations per feed reached`,
    });
  }

  const createResult = await visualizationRepository.create({
    userId,
    feedId: input.feedId,
    feedName: feed.name,
    insightId: input.insightId,
    insightTitle: insight.title,
    trackableMetric: insight.trackableMetric,
    chartConfig: input.chartConfig,
    transformInstructions: input.transformInstructions,
    chartData: null,
    status: 'pending',
  });

  if (!createResult.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: createResult.error });
  }

  return ok(createResult.value);
}
