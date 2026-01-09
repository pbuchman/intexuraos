/**
 * Get data insight snapshot use case.
 * Retrieves pre-computed snapshot for a composite feed.
 */
import type { Result } from '@intexuraos/common-core';
import { err, ok } from '@intexuraos/common-core';
import type { DataInsightSnapshot, SnapshotRepository } from '../index.js';

export interface GetDataInsightSnapshotDeps {
  snapshotRepository: SnapshotRepository;
}

export interface GetDataInsightSnapshotError {
  code: 'NOT_FOUND' | 'REPOSITORY_ERROR';
  message: string;
}

export async function getDataInsightSnapshot(
  feedId: string,
  userId: string,
  deps: GetDataInsightSnapshotDeps
): Promise<Result<DataInsightSnapshot, GetDataInsightSnapshotError>> {
  const { snapshotRepository } = deps;

  const snapshotResult = await snapshotRepository.getByFeedId(feedId, userId);

  if (!snapshotResult.ok) {
    return err({
      code: 'REPOSITORY_ERROR',
      message: snapshotResult.error,
    });
  }

  if (snapshotResult.value === null) {
    return err({
      code: 'NOT_FOUND',
      message: 'Snapshot not found',
    });
  }

  return ok(snapshotResult.value);
}
