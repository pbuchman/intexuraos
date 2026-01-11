/**
 * Refresh visualizations for feed use case.
 * Regenerates all ready visualizations for a feed after snapshot refresh.
 */
import type { Result } from '@intexuraos/common-core';
import { ok } from '@intexuraos/common-core';
import type { VisualizationRepository } from '../repository.js';
import type { VisualizationGenerationService } from '../types.js';
import type { SnapshotRepository } from '../../snapshot/index.js';
import { generateVisualizationContent } from './generateVisualizationContent.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RefreshVisualizationsForFeedDeps {
  visualizationRepository: VisualizationRepository;
  visualizationGenerationService: VisualizationGenerationService;
  snapshotRepository: SnapshotRepository;
  logger?: BasicLogger;
}

export interface RefreshVisualizationsResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: { visualizationId: string; error: string }[];
}

export async function refreshVisualizationsForFeed(
  feedId: string,
  userId: string,
  deps: RefreshVisualizationsForFeedDeps
): Promise<Result<RefreshVisualizationsResult, never>> {
  const { visualizationRepository, visualizationGenerationService, snapshotRepository, logger } = deps;

  logger?.info({ feedId, userId }, 'Refreshing visualizations for feed');

  const listResult = await visualizationRepository.listByFeedId(feedId, userId);
  if (!listResult.ok) {
    logger?.warn({ feedId, error: listResult.error }, 'Failed to list visualizations');
    return ok({
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    });
  }

  const visualizations = listResult.value;
  const readyVisualizations = visualizations.filter((v) => v.status === 'ready');

  logger?.info(
    { feedId, total: visualizations.length, ready: readyVisualizations.length },
    'Found visualizations to refresh'
  );

  if (readyVisualizations.length === 0) {
    return ok({
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
    });
  }

  const errors: { visualizationId: string; error: string }[] = [];
  let succeeded = 0;

  for (const viz of readyVisualizations) {
    logger?.info({ visualizationId: viz.id }, 'Refreshing visualization');

    const result = await generateVisualizationContent(viz.id, feedId, userId, {
      visualizationRepository,
      visualizationGenerationService,
      snapshotRepository,
      ...(logger !== undefined ? { logger } : {}),
    });

    if (result.ok) {
      succeeded += 1;
    } else {
      logger?.warn({ visualizationId: viz.id, error: result.error }, 'Failed to refresh visualization');
      errors.push({
        visualizationId: viz.id,
        error: result.error.message,
      });
    }
  }

  logger?.info(
    { feedId, total: readyVisualizations.length, succeeded, failed: errors.length },
    'Visualization refresh completed'
  );

  return ok({
    total: readyVisualizations.length,
    succeeded,
    failed: errors.length,
    errors,
  });
}
