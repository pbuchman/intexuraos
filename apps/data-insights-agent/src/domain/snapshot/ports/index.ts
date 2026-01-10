/**
 * Snapshot domain ports.
 */
import type { Result } from '@intexuraos/common-core';
import type { DataInsightSnapshot } from '../models/index.js';
import type { CompositeFeedData } from '../../compositeFeed/schemas/index.js';

/**
 * Repository interface for snapshot persistence.
 */
export interface SnapshotRepository {
  /**
   * Get a snapshot by feed ID for a specific user.
   * Returns null if not found or not owned by user.
   */
  getByFeedId(feedId: string, userId: string): Promise<Result<DataInsightSnapshot | null, string>>;

  /**
   * Create or update a snapshot for a feed.
   * Sets generatedAt to now and expiresAt to now + TTL.
   */
  upsert(
    feedId: string,
    userId: string,
    feedName: string,
    data: CompositeFeedData
  ): Promise<Result<DataInsightSnapshot, string>>;

  /**
   * Delete a snapshot owned by the specified user.
   */
  delete(feedId: string, userId: string): Promise<Result<void, string>>;

  /**
   * Delete a snapshot by feed ID without user ownership check.
   * Used for cascade delete when a feed is deleted.
   */
  deleteByFeedId(feedId: string): Promise<Result<void, string>>;

  /**
   * List all snapshots for a user.
   */
  listByUserId(userId: string): Promise<Result<DataInsightSnapshot[], string>>;
}
