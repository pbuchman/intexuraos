/**
 * Refresh snapshot use case.
 * Computes fresh composite feed data and stores it as a snapshot.
 * Optionally refreshes visualizations after snapshot is updated.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CompositeFeedRepository,
  MobileNotificationsClient,
} from '../../compositeFeed/index.js';
import { getCompositeFeedData } from '../../compositeFeed/usecases/getCompositeFeedData.js';
import type { DataSourceRepository } from '../../dataSource/index.js';
import type { DataInsightSnapshot, SnapshotRepository } from '../index.js';
import type {
  VisualizationRepository,
  VisualizationGenerationService,
} from '../../visualization/index.js';
import { refreshVisualizationsForFeed } from '../../visualization/index.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RefreshSnapshotDeps {
  snapshotRepository: SnapshotRepository;
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
  visualizationRepository?: VisualizationRepository;
  visualizationGenerationService?: VisualizationGenerationService;
  logger?: BasicLogger;
  refreshVisualizations?: boolean;
}

export interface RefreshSnapshotError {
  code: 'FEED_NOT_FOUND' | 'REPOSITORY_ERROR' | 'COMPUTATION_ERROR';
  message: string;
}

export async function refreshSnapshot(
  feedId: string,
  userId: string,
  deps: RefreshSnapshotDeps
): Promise<Result<DataInsightSnapshot, RefreshSnapshotError>> {
  const {
    snapshotRepository,
    compositeFeedRepository,
    dataSourceRepository,
    mobileNotificationsClient,
    visualizationRepository,
    visualizationGenerationService,
    logger,
    refreshVisualizations = false,
  } = deps;

  logger?.info({ feedId, userId }, 'Refreshing snapshot');

  const feedResult = await compositeFeedRepository.getById(feedId, userId);

  if (!feedResult.ok) {
    logger?.error({ feedId, userId, error: feedResult.error }, 'Failed to fetch feed for snapshot refresh');
    return err({
      code: 'REPOSITORY_ERROR',
      message: feedResult.error,
    });
  }

  if (feedResult.value === null) {
    logger?.warn({ feedId, userId }, 'Feed not found for snapshot refresh');
    return err({
      code: 'FEED_NOT_FOUND',
      message: 'Composite feed not found',
    });
  }

  const feed = feedResult.value;
  logger?.info({ feedId, feedName: feed.name }, 'Computing composite feed data for snapshot');

  const dataResult = await getCompositeFeedData(feedId, userId, {
    compositeFeedRepository,
    dataSourceRepository,
    mobileNotificationsClient,
    ...(logger !== undefined ? { logger } : {}),
  });

  if (!dataResult.ok) {
    logger?.error({ feedId, error: dataResult.error }, 'Failed to compute composite feed data');
    return err({
      code: 'COMPUTATION_ERROR',
      message: dataResult.error.message,
    });
  }

  const staticSourceCount = dataResult.value.staticSources.length;
  const notificationCount = dataResult.value.notifications.reduce((sum, n) => sum + n.items.length, 0);
  logger?.info({ feedId, staticSourceCount, notificationCount }, 'Upserting snapshot to repository');

  const snapshotResult = await snapshotRepository.upsert(
    feedId,
    userId,
    feed.name,
    dataResult.value
  );

  if (!snapshotResult.ok) {
    logger?.error({ feedId, error: snapshotResult.error }, 'Failed to upsert snapshot');
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  logger?.info({ feedId, snapshotId: snapshotResult.value.feedId }, 'Snapshot refresh completed');

  if (
    refreshVisualizations &&
    visualizationRepository !== undefined &&
    visualizationGenerationService !== undefined
  ) {
    logger?.info({ feedId }, 'Starting visualization refresh');

    refreshVisualizationsForFeed(feedId, userId, {
      visualizationRepository,
      visualizationGenerationService,
      snapshotRepository,
      ...(logger !== undefined ? { logger } : {}),
    })
      .then((result) => {
        if (result.ok) {
          logger?.info(
            {
              feedId,
              total: result.value.total,
              succeeded: result.value.succeeded,
              failed: result.value.failed,
            },
            'Visualization refresh completed'
          );
          if (result.value.errors.length > 0) {
            logger?.warn({ feedId, errors: result.value.errors }, 'Some visualizations failed to refresh');
          }
        }
      })
      .catch((error: unknown) => {
        logger?.warn({ feedId, error }, 'Visualization refresh failed (non-fatal)');
      });
  }

  return ok(snapshotResult.value);
}
