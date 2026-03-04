import type { Logger } from '@intexuraos/common-core';
import type { DocumentReference } from '@google-cloud/firestore';

export function buildLockDocPath(repository: string, prNumber: number): string {
  return `pr_task_locks/${repository.replace(/\//g, '_')}_${String(prNumber)}`;
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
