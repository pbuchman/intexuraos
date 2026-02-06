import type { Result } from '@intexuraos/common-core';
import type { PRTaskLock } from '../models/prTaskLock.js';

export type PRTaskLockError =
  | { code: 'LOCK_HELD'; message: string; lockedByTaskId: string }
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'FIRESTORE_ERROR'; message: string };

export interface PRTaskLockRepository {
  /**
   * Acquire a lock for a PR. Creates lock if none exists, fails if locked.
   * Overwrites expired locks (30 min TTL).
   */
  acquireLock(
    lockKey: string,
    taskId: string,
    userId: string
  ): Promise<Result<PRTaskLock, PRTaskLockError>>;

  /**
   * Release a lock. Deletes the lock document.
   */
  releaseLock(lockKey: string): Promise<Result<void, PRTaskLockError>>;

  /**
   * Find a lock by key. Returns null if not found.
   */
  findLock(lockKey: string): Promise<Result<PRTaskLock | null, PRTaskLockError>>;
}
