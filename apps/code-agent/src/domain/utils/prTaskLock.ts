import type { Logger } from '@intexuraos/common-core';
import type { DocumentReference, Transaction } from '@google-cloud/firestore';
import { MERGE_CONFLICT_SYSTEM_PROMPT_HASH } from '../models/codeTask.js';

export interface LockCleanupInfo { repository: string; prNumber: number }

export function buildLockDocPath(repository: string, prNumber: number): string {
  return `pr_task_locks/${repository.replace(/\//g, '_')}_${String(prNumber)}`;
}

/**
 * Determines whether a task's terminal state should trigger lock cleanup.
 * Only original lock-owning tasks (no parentTaskId) with a prNumber qualify.
 * Returns an array so callers can spread into accumulated cleanups.
 */
export function buildLockCleanups(task: {
  repository: string;
  prNumber?: number;
  parentTaskId?: string;
  followUpReason?: string;
  systemPromptHash?: string;
}): LockCleanupInfo[] {
  const isMergeConflictTask =
    task.followUpReason === 'merge_conflict' ||
    task.systemPromptHash === MERGE_CONFLICT_SYSTEM_PROMPT_HASH;

  if (task.prNumber !== undefined && task.parentTaskId === undefined && !isMergeConflictTask) {
    return [{ repository: task.repository, prNumber: task.prNumber }];
  }
  return [];
}

export async function deletePRTaskLock(
  firestore: { doc: (path: string) => DocumentReference },
  repository: string,
  prNumber: number,
  logger: Logger
): Promise<void> {
  const lockDocPath = buildLockDocPath(repository, prNumber);
  try {
    await firestore.doc(lockDocPath).delete();
    logger.info({ lockDocPath, repository, prNumber }, 'Deleted PR task lock');
  } catch (error) {
    logger.warn({ lockDocPath, error }, 'Failed to delete PR task lock (best-effort)');
  }
}

export async function deletePRTaskLockIfOwned(
  firestore: {
    doc: (path: string) => DocumentReference;
    runTransaction: <T>(operation: (transaction: Transaction) => Promise<T>) => Promise<T>;
  },
  repository: string,
  prNumber: number,
  expectedTaskId: string,
  logger: Logger,
): Promise<void> {
  const lockDocPath = buildLockDocPath(repository, prNumber);
  try {
    const outcome = await firestore.runTransaction(async (transaction) => {
      const lockRef = firestore.doc(lockDocPath);
      const snapshot = await transaction.get(lockRef);
      const lockData = snapshot.data() as Record<string, unknown> | undefined;
      const currentTaskId = snapshot.exists
        ? lockData?.['taskId']
        : undefined;

      if (currentTaskId !== expectedTaskId) {
        return {
          deleted: false,
          currentTaskId: typeof currentTaskId === 'string' ? currentTaskId : undefined,
        } as const;
      }

      transaction.delete(lockRef);
      return { deleted: true } as const;
    });

    if (outcome.deleted) {
      logger.info(
        { lockDocPath, repository, prNumber, expectedTaskId },
        'Deleted owned PR task lock',
      );
      return;
    }

    logger.info(
      {
        lockDocPath,
        repository,
        prNumber,
        expectedTaskId,
        ...(outcome.currentTaskId !== undefined && { currentTaskId: outcome.currentTaskId }),
      },
      'Skipped PR task lock deletion because ownership changed',
    );
  } catch (error) {
    logger.warn(
      { lockDocPath, expectedTaskId, error },
      'Failed to conditionally delete PR task lock (best-effort)',
    );
  }
}
