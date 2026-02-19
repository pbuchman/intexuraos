/**
 * Refresh feed visualizations use case.
 * Re-computes chart data for all visualizations of a feed after snapshot refresh.
 */

import type { SnapshotRepository } from '../../snapshot/index.js';
import type { DataTransformService } from '../../dataInsights/ports.js';
import type { VisualizationRepository } from '../ports/index.js';
import { buildCompositeFeedSchema } from '../../dataInsights/utils.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
  debug: (obj: object, msg: string) => void;
}

export interface RefreshFeedVisualizationsDeps {
  visualizationRepository: VisualizationRepository;
  snapshotRepository: SnapshotRepository;
  dataTransformService: DataTransformService;
  logger: BasicLogger;
}

export interface RefreshFeedVisualizationsResult {
  refreshed: number;
  failed: number;
  errors: { vizId: string; error: string }[];
}

export async function refreshFeedVisualizations(
  feedId: string,
  userId: string,
  deps: RefreshFeedVisualizationsDeps
): Promise<RefreshFeedVisualizationsResult> {
  const { visualizationRepository, snapshotRepository, dataTransformService, logger } = deps;

  const listResult = await visualizationRepository.listByFeedId(feedId);
  if (!listResult.ok) {
    logger.error({ feedId, error: listResult.error }, 'Failed to list visualizations for refresh');
    return { refreshed: 0, failed: 0, errors: [{ vizId: 'list', error: listResult.error }] };
  }

  const visualizations = listResult.value;
  if (visualizations.length === 0) {
    return { refreshed: 0, failed: 0, errors: [] };
  }

  logger.info(
    { feedId, count: visualizations.length },
    'Refreshing visualizations for feed'
  );

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);
  if (!snapshotResult.ok || snapshotResult.value === null) {
    logger.warn({ feedId }, 'No snapshot for visualization refresh, skipping');
    return { refreshed: 0, failed: 0, errors: [] };
  }

  const snapshot = snapshotResult.value;
  const jsonSchema = buildCompositeFeedSchema();

  let refreshed = 0;
  let failed = 0;
  const errors: { vizId: string; error: string }[] = [];

  for (const viz of visualizations) {
    await visualizationRepository.update(viz.id, { status: 'refreshing' });

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
      failed++;
      const errorMsg = transformResult.error.message;
      errors.push({ vizId: viz.id, error: errorMsg });
      await visualizationRepository.update(viz.id, {
        status: 'error',
        lastError: errorMsg,
      });
      logger.warn({ vizId: viz.id, error: errorMsg }, 'Visualization refresh failed');
      continue;
    }

    const now = new Date();
    await visualizationRepository.update(viz.id, {
      chartData: transformResult.value,
      status: 'ready',
      lastError: null,
      lastRefreshedAt: now,
    });
    refreshed++;
  }

  logger.info(
    { feedId, refreshed, failed },
    'Feed visualization refresh completed'
  );

  return { refreshed, failed, errors };
}
