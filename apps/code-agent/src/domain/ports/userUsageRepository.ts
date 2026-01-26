/**
 * Port for user usage data access.
 */

import type { UserUsage } from '../models/userUsage.js';

export interface UserUsageRepository {
  /** Get current usage for a user, creating default if not exists */
  getOrCreate(userId: string): Promise<UserUsage>;

  /** Update usage atomically */
  update(usage: UserUsage): Promise<void>;

  /** Increment concurrent tasks (atomic) */
  incrementConcurrent(userId: string): Promise<void>;

  /** Decrement concurrent tasks (atomic) */
  decrementConcurrent(userId: string): Promise<void>;

  /** Add cost and task count (atomic, handles window resets) */
  recordTaskStart(userId: string, estimatedCost: number): Promise<void>;

  /** Update actual cost when task completes */
  recordActualCost(userId: string, actualCost: number, estimatedCost: number): Promise<void>;
}
