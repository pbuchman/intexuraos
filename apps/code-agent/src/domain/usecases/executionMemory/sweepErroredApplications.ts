import { ok, err, type Logger, type Result } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';

export interface SweepErroredApplicationsDeps {
  logger: Logger;
  codeTaskRepo: Pick<CodeTaskRepository, 'listErroredExecutionMemoryPostRun' | 'update'>;
}

export interface SweepErroredApplicationsResult {
  requeued: number;
  skipped: number;
}

const MAX_TOTAL_RETRIES = 6;
const MIN_ERROR_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function sweepErroredApplications(
  deps: SweepErroredApplicationsDeps
): Promise<Result<SweepErroredApplicationsResult, { code: 'internal_error'; message: string }>> {
  const erroredResult = await deps.codeTaskRepo.listErroredExecutionMemoryPostRun();
  if (!erroredResult.ok) {
    return err({ code: 'internal_error', message: erroredResult.error.message });
  }

  let requeued = 0;
  let skipped = 0;

  for (const task of erroredResult.value) {
    const attempts = task.executionMemoryPostRun?.attempts ?? 0;
    const lastAttemptAt = task.executionMemoryPostRun?.lastAttemptAt;

    // Skip if too many total retries
    if (attempts >= MAX_TOTAL_RETRIES) {
      deps.logger.info(
        { taskId: task.id, attempts },
        'Sweep: skipping task — max total retries exceeded'
      );
      skipped += 1;
      continue;
    }

    // Skip if error is too recent (< 24 hours)
    if (lastAttemptAt !== undefined) {
      const errorAgeMs = Date.now() - lastAttemptAt.toMillis();
      if (errorAgeMs < MIN_ERROR_AGE_MS) {
        deps.logger.info(
          { taskId: task.id, errorAgeMs },
          'Sweep: skipping task — error too recent'
        );
        skipped += 1;
        continue;
      }
    }

    const updateResult = await deps.codeTaskRepo.update(task.id, {
      executionMemoryPostRun: {
        status: 'pending',
        attempts,
        lastAttemptAt: task.executionMemoryPostRun?.lastAttemptAt ?? Timestamp.now(),
        generatedMemoryIds: task.executionMemoryPostRun?.generatedMemoryIds ?? [],
      },
    });

    if (!updateResult.ok) {
      deps.logger.warn(
        { taskId: task.id, error: updateResult.error.message },
        'Sweep: failed to requeue task'
      );
      skipped += 1;
      continue;
    }

    deps.logger.info({ taskId: task.id }, 'Sweep: requeued errored task for retry');
    requeued += 1;
  }

  return ok({ requeued, skipped });
}
