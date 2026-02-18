/**
 * Compute visualization use case.
 * Runs the LLM data transform and updates the visualization with results.
 * Called fire-and-forget after creation, or for manual/scheduled refresh.
 */

import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { SnapshotRepository } from '../../snapshot/index.js';
import type { DataTransformService } from '../../dataInsights/ports.js';
import type { VisualizationRepository } from '../ports/index.js';
import type { Visualization } from '../models/index.js';
import { buildCompositeFeedSchema } from '../../dataInsights/utils.js';

export interface ComputeVisualizationDeps {
  visualizationRepository: VisualizationRepository;
  snapshotRepository: SnapshotRepository;
  dataTransformService: DataTransformService;
}

export interface ComputeVisualizationError {
  code: 'NOT_FOUND' | 'SNAPSHOT_NOT_FOUND' | 'TRANSFORMATION_ERROR' | 'REPOSITORY_ERROR';
  message: string;
}

export async function computeVisualization(
  visualizationId: string,
  userId: string,
  deps: ComputeVisualizationDeps
): Promise<Result<Visualization, ComputeVisualizationError>> {
  const { visualizationRepository, snapshotRepository, dataTransformService } = deps;

  const vizResult = await visualizationRepository.getById(visualizationId, userId);
  if (!vizResult.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: vizResult.error });
  }

  if (vizResult.value === null) {
    return err({ code: 'NOT_FOUND', message: 'Visualization not found' });
  }

  const viz = vizResult.value;

  const snapshotResult = await snapshotRepository.getByFeedId(viz.feedId, viz.userId);
  if (!snapshotResult.ok) {
    await visualizationRepository.update(visualizationId, {
      status: 'error',
      lastError: `Snapshot fetch failed: ${snapshotResult.error}`,
    });
    return err({ code: 'REPOSITORY_ERROR', message: snapshotResult.error });
  }

  if (snapshotResult.value === null) {
    await visualizationRepository.update(visualizationId, {
      status: 'error',
      lastError: 'No snapshot available for this feed',
    });
    return err({
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'No snapshot available. Please refresh the feed first.',
    });
  }

  const snapshot = snapshotResult.value;
  const jsonSchema = buildCompositeFeedSchema();

  const transformResult = await dataTransformService.transformData(
    viz.userId,
    jsonSchema,
    snapshot.data,
    viz.chartConfig,
    viz.transformInstructions,
    {
      title: viz.insightTitle,
      trackableMetric: viz.trackableMetric,
    }
  );

  if (!transformResult.ok) {
    await visualizationRepository.update(visualizationId, {
      status: 'error',
      lastError: transformResult.error.message,
    });
    return err({
      code: 'TRANSFORMATION_ERROR',
      message: transformResult.error.message,
    });
  }

  const now = new Date();
  const updateResult = await visualizationRepository.update(visualizationId, {
    chartData: transformResult.value,
    status: 'ready',
    lastError: null,
    lastRefreshedAt: now,
  });

  if (!updateResult.ok) {
    return err({ code: 'REPOSITORY_ERROR', message: updateResult.error });
  }

  return ok(updateResult.value);
}
