/**
 * Refresh all snapshots use case.
 * Batch refresh for all composite feeds across all users.
 * Used by scheduler.
 */
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type {
  CompositeFeedRepository,
  MobileNotificationsClient,
} from '../../compositeFeed/index.js';
import type { DataSourceRepository } from '../../dataSource/index.js';
import type { SnapshotRepository } from '../index.js';
import { refreshSnapshot } from './refreshSnapshot.js';

interface BasicLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface RefreshAllSnapshotsDeps {
  snapshotRepository: SnapshotRepository;
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
  logger: BasicLogger;
}

export interface RefreshAllSnapshotsResult {
  refreshed: number;
  failed: number;
  errors: { feedId: string; error: string }[];
}

export async function refreshAllSnapshots(
  deps: RefreshAllSnapshotsDeps
): Promise<Result<RefreshAllSnapshotsResult, string>> {
  const { compositeFeedRepository, logger } = deps;

  logger.info({}, 'Starting batch snapshot refresh for all feeds');

  const feedsResult = await compositeFeedRepository.listAll();

  if (!feedsResult.ok) {
    logger.error({ error: feedsResult.error }, 'Failed to list feeds for batch refresh');
    return err(`Failed to list feeds: ${feedsResult.error}`);
  }

  const feeds = feedsResult.value;
  logger.info({ feedCount: feeds.length }, 'Retrieved feeds for batch refresh');

  let refreshed = 0;
  let failed = 0;
  const errors: { feedId: string; error: string }[] = [];

  for (const feed of feeds) {
    logger.info({ feedId: feed.id, feedName: feed.name, userId: feed.userId }, 'Processing feed');
    const result = await refreshSnapshot(feed.id, feed.userId, deps);

    if (result.ok) {
      refreshed++;
      logger.info({ feedId: feed.id }, 'Feed snapshot refreshed successfully');
    } else {
      failed++;
      logger.error({ feedId: feed.id, error: result.error }, 'Feed snapshot refresh failed');
      errors.push({
        feedId: feed.id,
        error: result.error.message,
      });
    }
  }

  logger.info({ refreshed, failed, errorCount: errors.length }, 'Batch snapshot refresh completed');

  return ok({
    refreshed,
    failed,
    errors,
  });
}
