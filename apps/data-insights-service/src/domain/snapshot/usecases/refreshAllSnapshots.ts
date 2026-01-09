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

export interface RefreshAllSnapshotsDeps {
  snapshotRepository: SnapshotRepository;
  compositeFeedRepository: CompositeFeedRepository;
  dataSourceRepository: DataSourceRepository;
  mobileNotificationsClient: MobileNotificationsClient;
}

export interface RefreshAllSnapshotsResult {
  refreshed: number;
  failed: number;
  errors: { feedId: string; error: string }[];
}

export async function refreshAllSnapshots(
  deps: RefreshAllSnapshotsDeps
): Promise<Result<RefreshAllSnapshotsResult, string>> {
  const { compositeFeedRepository } = deps;

  const feedsResult = await compositeFeedRepository.listAll();

  if (!feedsResult.ok) {
    return err(`Failed to list feeds: ${feedsResult.error}`);
  }

  const feeds = feedsResult.value;
  let refreshed = 0;
  let failed = 0;
  const errors: { feedId: string; error: string }[] = [];

  for (const feed of feeds) {
    const result = await refreshSnapshot(feed.id, feed.userId, deps);

    if (result.ok) {
      refreshed++;
    } else {
      failed++;
      errors.push({
        feedId: feed.id,
        error: result.error.message,
      });
    }
  }

  return ok({
    refreshed,
    failed,
    errors,
  });
}
