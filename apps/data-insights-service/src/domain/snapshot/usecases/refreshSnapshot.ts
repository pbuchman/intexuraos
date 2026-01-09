/**
 * Refresh snapshot use case.
 * Computes fresh composite feed data and stores it as a snapshot.
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

export interface RefreshSnapshotDeps {
  snapshotRepository: SnapshotRepository;
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
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
  const { snapshotRepository, compositeFeedRepository, dataSourceRepository, mobileNotificationsClient } = deps;

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

  const dataResult = await getCompositeFeedData(feedId, userId, {
    compositeFeedRepository,
    dataSourceRepository,
    mobileNotificationsClient,
  });

  if (!dataResult.ok) {
    return err({
      code: 'COMPUTATION_ERROR',
      message: dataResult.error.message,
    });
  }

  const snapshotResult = await snapshotRepository.upsert(
    feedId,
    userId,
    feed.name,
    dataResult.value
  );

  if (!snapshotResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  return ok(snapshotResult.value);
}
