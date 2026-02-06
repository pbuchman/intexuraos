import { Timestamp } from '@google-cloud/firestore';

/**
 * Lock document to ensure only one task runs per PR at a time.
 * Collection: pr_task_locks
 * Document ID: Format `${repository}:${prNumber}`
 *
 * Purpose: Prevents concurrent tasks from modifying the same PR (INT-465).
 * Cleanup: Documents expire after 30 min TTL for zombie prevention.
 */
export interface PRTaskLock {
  id: string;              // Format: `${repository}:${prNumber}`
  activeTaskId: string;    // Currently running task ID
  lockedAt: Timestamp;     // When lock was acquired
  lockedBy: string;        // User ID who acquired the lock
  expiresAt: Timestamp;    // TTL for automatic cleanup (30 min)
}
