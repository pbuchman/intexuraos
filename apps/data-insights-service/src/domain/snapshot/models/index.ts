/**
 * Snapshot domain models.
 */
import type { CompositeFeedData } from '../../compositeFeed/schemas/index.js';

/**
 * A pre-computed snapshot of composite feed data.
 */
export interface DataInsightSnapshot {
  id: string;
  userId: string;
  feedId: string;
  feedName: string;
  data: CompositeFeedData;
  generatedAt: Date;
  expiresAt: Date;
}

/**
 * Snapshot TTL in minutes (matches scheduler interval).
 */
export const SNAPSHOT_TTL_MINUTES = 15;

/**
 * Snapshot TTL in milliseconds.
 */
export const SNAPSHOT_TTL_MS = SNAPSHOT_TTL_MINUTES * 60 * 1000;
