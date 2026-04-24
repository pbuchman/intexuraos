import { ok, err, type Logger, type Result } from '@intexuraos/common-core';
import type { ExecutionMemoryRepository } from '../../repositories/executionMemoryRepository.js';

export interface PruneStaleMemoriesDeps {
  logger: Logger;
  executionMemoryRepo: Pick<ExecutionMemoryRepository, 'listStaleUnused' | 'update'>;
}

export interface PruneStaleMemoriesResult {
  archived: number;
  skipped: number;
}

const DEFAULT_MAX_AGE_DAYS = 30;

export async function pruneStaleMemories(
  deps: PruneStaleMemoriesDeps,
  options: { maxAgeDays?: number; dryRun?: boolean }
): Promise<Result<PruneStaleMemoriesResult, { code: 'internal_error'; message: string }>> {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const dryRun = options.dryRun ?? false;
  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const staleResult = await deps.executionMemoryRepo.listStaleUnused(cutoffDate);
  if (!staleResult.ok) {
    return err({ code: 'internal_error', message: staleResult.error.message });
  }

  let archived = 0;
  let skipped = 0;

  for (const memory of staleResult.value) {
    if (dryRun) {
      deps.logger.info(
        { memoryId: memory.id, title: memory.title },
        'Prune: would archive stale memory (dry run)'
      );
      archived += 1;
      continue;
    }

    const updateResult = await deps.executionMemoryRepo.update(memory.id, {
      status: 'archived',
    });

    if (!updateResult.ok) {
      deps.logger.warn(
        { memoryId: memory.id, error: updateResult.error.message },
        'Prune: failed to archive memory'
      );
      skipped += 1;
      continue;
    }

    deps.logger.info({ memoryId: memory.id }, 'Prune: archived stale memory');
    archived += 1;
  }

  return ok({ archived, skipped });
}
