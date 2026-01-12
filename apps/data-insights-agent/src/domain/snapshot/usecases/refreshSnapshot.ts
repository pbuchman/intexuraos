import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type {
  CompositeFeedRepository,
  MobileNotificationsClient,
} from '../../compositeFeed/index.js';
import { getCompositeFeedData } from '../../compositeFeed/usecases/getCompositeFeedData.js';
import type { DataSourceRepository } from '../../dataSource/index.js';
import type { DataInsightSnapshot, SnapshotRepository } from '../index.js';

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
  logger?: BasicLogger;
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
    logger,
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

  return ok(snapshotResult.value);
}
